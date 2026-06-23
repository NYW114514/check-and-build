import { supabase } from '../supabase'
import { Review, ProjectReview } from '../types'

// 初审通过：submitted → pending_final
export async function approveSubmission(
  submissionId: string,
  reviewerId: string,
  feedback?: string,
  reviewerLink?: string
): Promise<Review> {
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single()
  if (subError) throw subError
  if (submission.builder_id === reviewerId) {
    throw new Error('Self-review is not allowed')
  }

  const taskId = submission.task_id

  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .insert({
      submission_id: submissionId,
      task_id: taskId,
      reviewer_id: reviewerId,
      decision: 'approved',
      feedback: feedback ?? null,
      reviewer_link: reviewerLink ?? null,
      review_stage: 'initial',
    })
    .select()
    .single()
  if (reviewError) throw reviewError

  await supabase
    .from('submissions')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', submissionId)

  const { error: taskUpdateError } = await supabase
    .from('tasks')
    .update({
      status: 'pending_final',
      approved_submission_id: submissionId,
      return_to_reviewer_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
  if (taskUpdateError) throw taskUpdateError


  const { data: taskData } = await supabase
    .from('tasks')
    .select('project_id')
    .eq('id', taskId)
    .single()

  await supabase.from('point_transactions').insert({
    user_id: reviewerId,
    project_id: taskData?.project_id ?? null,
    task_id: taskId,
    submission_id: submissionId,
    review_id: review.id,
    type: 'review',
    amount: 10,
    status: 'pending',
    description: `Initial review approved: ${taskId}`,
  })

  return review
}

// 最终审核通过：pending_final → approved
export async function finalApproveSubmission(
  submissionId: string,
  reviewerId: string,
  feedback?: string,
  reviewerLink?: string
): Promise<Review> {
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single()
  if (subError) throw subError

  const taskId = submission.task_id

  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .insert({
      submission_id: submissionId,
      task_id: taskId,
      reviewer_id: reviewerId,
      decision: 'approved',
      feedback: feedback ?? null,
      reviewer_link: reviewerLink ?? null,
      review_stage: 'final',
    })
    .select()
    .single()
  if (reviewError) throw reviewError

  await supabase
    .from('tasks')
    .update({
      status: 'approved',
      return_to_reviewer_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)

  return review
}

// 初审 reject：退给 builder，task → in_progress，submission → rejected
export async function rejectToBuilder(
  submissionId: string,
  reviewerId: string,
  feedback: string,
  reviewerLink?: string
): Promise<Review> {
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single()
  if (subError) throw subError
  if (submission.builder_id === reviewerId) {
    throw new Error('Self-review is not allowed')
  }

  const taskId = submission.task_id

  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .insert({
      submission_id: submissionId,
      task_id: taskId,
      reviewer_id: reviewerId,
      decision: 'rejected',
      feedback,
      reviewer_link: reviewerLink ?? null,
      review_stage: 'initial',
    })
    .select()
    .single()
  if (reviewError) throw reviewError

  await supabase
    .from('submissions')
    .update({ status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', submissionId)

  await supabase
    .from('tasks')
    .update({
      status: 'in_progress',
      return_to_reviewer_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)

  await supabase
    .from('point_transactions')
    .update({ status: 'cancelled' })
    .eq('submission_id', submissionId)
    .eq('status', 'pending')

  return review
}

// 终审 reject：退给上一个初审人，task → submitted，submission → pending
export async function returnToInitialReviewer(
  submissionId: string,
  reviewerId: string,
  feedback: string,
  reviewerLink?: string
): Promise<Review> {
  const { data: submission, error: subError } = await supabase
    .from('submissions')
    .select('*')
    .eq('id', submissionId)
    .single()

  if (subError) throw subError

  const taskId = submission.task_id

  // 找到最近一次 initial review 的 reviewer，作为退回对象
  const { data: lastInitialReview, error: lastReviewError } = await supabase
    .from('reviews')
    .select('reviewer_id')
    .eq('task_id', taskId)
    .eq('decision', 'approved')
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lastReviewError) throw lastReviewError

  const returnToId = lastInitialReview?.reviewer_id ?? null

  const { data: review, error: reviewError } = await supabase
    .from('reviews')
    .insert({
      submission_id: submissionId,
      task_id: taskId,
      reviewer_id: reviewerId,
      decision: 'rejected',
      feedback,
      reviewer_link: reviewerLink ?? null,
      review_stage: 'final',
    })
    .select()
    .single()
  if (reviewError) throw reviewError

  // 把 submission 改回 pending，让初审人能在 Review Queue 看到
  await supabase
    .from('submissions')
    .update({ status: 'pending', updated_at: new Date().toISOString() })
    .eq('id', submissionId)

  await supabase
    .from('tasks')
    .update({
      status: 'submitted',
      return_to_reviewer_id: returnToId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)

  // builder 的 build points 保留 pending，不 cancel

  return review
}

// 退给上一个终审人（Admin），task → submitted，submission 保持 pending
export async function returnToFinalReviewer(
  taskId: string,
  reviewerId: string,
  comment?: string
): Promise<void> {
  const { data: lastFinalReview } = await supabase
    .from('reviews')
    .select('reviewer_id')
    .eq('task_id', taskId)
    .eq('decision', 'approved')
    .eq('review_stage', 'final')
    .order('reviewed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const returnToId = lastFinalReview?.reviewer_id ?? null

  if (comment) {
    const { data: task } = await supabase
      .from('tasks')
      .select('approved_submission_id')
      .eq('id', taskId)
      .single()

    if (task?.approved_submission_id) {
      await supabase.from('reviews').insert({
        submission_id: task.approved_submission_id,
        task_id: taskId,
        reviewer_id: reviewerId,
        decision: 'rejected',
        feedback: comment,
        reviewer_link: null,
        review_stage: 'final',
      })
    }
  }

  await supabase
    .from('point_transactions')
    .update({ status: 'cancelled' })
    .eq('task_id', taskId)
    .eq('type', 'review')
    .eq('status', 'pending')

  await supabase
    .from('tasks')
    .update({
      status: 'pending_final',
      return_to_reviewer_id: returnToId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)
}

// project 级审核
export async function createProjectReview(
  projectId: string,
  reviewerId: string,
  stage: 'l3_initial' | 'admin_final',
  decision: 'approved' | 'rejected',
  feedback?: string,
  reviewerLink?: string
): Promise<ProjectReview> {
  const { data, error } = await supabase
    .from('project_reviews')
    .insert({
      project_id: projectId,
      reviewer_id: reviewerId,
      stage,
      decision,
      feedback: feedback ?? null,
      reviewer_link: reviewerLink ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// 保留旧函数名做向后兼容，指向 rejectToBuilder
export async function rejectSubmission(
  submissionId: string,
  reviewerId: string,
  feedback: string,
  reviewerLink?: string,
  reviewStage: 'initial' | 'final' = 'initial'
): Promise<Review> {
  if (reviewStage === 'final') {
    return returnToInitialReviewer(submissionId, reviewerId, feedback, reviewerLink)
  }
  return rejectToBuilder(submissionId, reviewerId, feedback, reviewerLink)
}

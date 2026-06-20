import { supabase } from '../supabase'
import { Review } from '../types'

export async function approveSubmission(
  submissionId: string,
  reviewerId: string,
  feedback?: string
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
    })
    .select()
    .single()
  if (reviewError) throw reviewError

  await supabase
    .from('submissions')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', submissionId)

  await supabase
    .from('tasks')
    .update({
      status: 'approved',
      approved_submission_id: submissionId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', taskId)

  // await supabase
  //   .from('point_transactions')
  //   .update({ status: 'earned' })
  //   .eq('submission_id', submissionId)
  //   .eq('type', 'build')
  //   .eq('status', 'pending')

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
    description: `Review approved: ${taskId}`,
  })

  // await supabase.rpc('increment_points', { uid: submission.builder_id, pts: 10 })
  // await supabase.rpc('increment_points', { uid: reviewerId, pts: 10 })

  return review
}

export async function rejectSubmission(
  submissionId: string,
  reviewerId: string,
  feedback: string
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
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', taskId)

  await supabase
    .from('point_transactions')
    .update({ status: 'cancelled' })
    .eq('submission_id', submissionId)
    .eq('status', 'pending')

  return review
}
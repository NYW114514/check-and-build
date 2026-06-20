import { supabase } from '../supabase'
import { Submission } from '../types'

export async function submitTask(
  taskId: string,
  builderId: string,
  githubUrl: string,
  notes?: string
): Promise<Submission> {
  // 检查是否已 enroll
  const { data: enrollment } = await supabase
    .from('task_enrollments')
    .select('id')
    .eq('task_id', taskId)
    .eq('user_id', builderId)
    .maybeSingle()
  if (!enrollment) throw new Error('User must enroll before submitting')

  // 拿 task 的 project_id 和 point_value
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('project_id, point_value')
    .eq('id', taskId)
    .single()
  if (taskError) throw taskError

  // 创建 submission
  const { data: submission, error } = await supabase
    .from('submissions')
    .insert({
      task_id: taskId,
      builder_id: builderId,
      github_url: githubUrl,
      notes: notes ?? null,
      status: 'pending',
    })
    .select()
    .single()
  if (error) throw error

  // task → submitted
  await supabase
    .from('tasks')
    .update({ status: 'submitted', updated_at: new Date().toISOString() })
    .eq('id', taskId)

  // 创建 pending build points
  await supabase.from('point_transactions').insert({
    user_id: builderId,
    project_id: task.project_id,
    task_id: taskId,
    submission_id: submission.id,
    type: 'build',
    amount: task.point_value,
    status: 'pending',
    description: `Build pending: ${taskId}`,
  })

  return submission
}

export async function getSubmissionsByTask(taskId: string): Promise<Submission[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select('*')
    .eq('task_id', taskId)
    .order('submitted_at', { ascending: false })
  if (error) throw error
  return data
}
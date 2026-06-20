import { supabase } from '../supabase'
import { Task, Difficulty } from '../types'

export async function getTasksByProject(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

export async function getOpenTasks(difficulty?: Difficulty): Promise<Task[]> {
  let query = supabase
    .from('tasks')
    .select('*, project:projects!tasks_project_id_fkey(status)')
    .in('status', ['open', 'in_progress'])

  if (difficulty) query = query.eq('difficulty', difficulty)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).filter((t: any) => t.project?.status === 'active')
}

export async function createTask(
  task: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'approved_submission_id'>
): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert(task)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function enrollTask(taskId: string, userId: string): Promise<void> {
  const { data: taskData, error: taskError } = await supabase
    .from('tasks')
    .select('difficulty')
    .eq('id', taskId)
    .single()

  if (taskError) throw taskError

  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()

  if (userError) throw userError

  if (userData.role === 'l1' && taskData.difficulty === 'advanced') {
    throw new Error('L1 developers can only enroll in basic tasks.')
  }

  const { count, error: countError } = await supabase
    .from('task_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('task_id', taskId)

  if (countError) throw countError

  if ((count ?? 0) >= 3) {
    throw new Error('Task is full (max 3 developers)')
  }

  const { error: insertError } = await supabase
    .from('task_enrollments')
    .insert({ task_id: taskId, user_id: userId })

  if (insertError) throw insertError

  const { error: updateError } = await supabase
    .from('tasks')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', taskId)

  if (updateError) throw updateError
}

export async function updateTaskStatus(
  id: string,
  status: Task['status']
): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}
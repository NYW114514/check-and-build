import { supabase } from '../supabase'
import { Project } from '../types'

export async function getProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getProjectById(id: string): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createProject(
  project: Omit<Project, 'id' | 'created_at' | 'updated_at' | 'deployed_at'>
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert(project)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateProjectStatus(
  id: string,
  status: Project['status']
): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function claimProject(
  projectId: string,
  l3UserId: string
): Promise<Project> {
  const { data: user, error: userError } = await supabase
    .from('users')
    .select('email')
    .eq('id', l3UserId)
    .single()
  if (userError) throw userError

  const { data, error } = await supabase
    .from('projects')
    .update({
      l3_owner_id: l3UserId,
      contact_email: user.email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)
    .select()
    .single()
  if (error) throw error
  return data
}
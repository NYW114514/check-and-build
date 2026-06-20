import { supabase } from '../supabase'
import { User } from '../types'

export async function getUsers(): Promise<User[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_active', true)
  if (error) throw error
  return data
}

export async function getUserById(id: string): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createUser(user: Omit<User, 'id' | 'created_at' | 'total_points'>): Promise<User> {
  const { data, error } = await supabase
    .from('users')
    .insert(user)
    .select()
    .single()
  if (error) throw error
  return data
}
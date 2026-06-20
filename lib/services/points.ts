import { supabase } from '../supabase'
import { PointTransaction } from '../types'

export async function getPointsByUser(userId: string): Promise<PointTransaction[]> {
  const { data, error } = await supabase
    .from('point_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function assemblePayout(
  projectId: string,
  l3UserId: string,
  taskCount: number
): Promise<void> {
  const amount = taskCount * 10

  await supabase.from('point_transactions').insert({
    user_id: l3UserId,
    project_id: projectId,
    type: 'assemble',
    amount,
    status: 'earned',
    description: `L3 assembly payout: ${taskCount} tasks × 10 pts`,
  })

  await supabase.rpc('increment_points', { uid: l3UserId, pts: amount })
}
'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../../lib/context/UserContext'
import { supabase } from '../../../lib/supabase'
import { submitTask } from '../../../lib/services/submissions'
import { Task } from '../../../lib/types'

export default function SubmitPage() {
  const { currentUser } = useUser()
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [githubUrls, setGithubUrls] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

useEffect(() => {
  if (!currentUser) { setLoading(false); return }
  
  supabase
    .from('task_enrollments')
    .select('task_id')
    .eq('user_id', currentUser.id)
    .then(async ({ data }) => {
      if (!data || data.length === 0) { setLoading(false); return }
      const taskIds = data.map(e => e.task_id)
      
      const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .in('id', taskIds)
        .eq('status', 'in_progress')
      
      if (!tasks) { setLoading(false); return }

      // 查每个 task 最近一次 rejected submission 的 feedback
      const tasksWithFeedback = await Promise.all(
        tasks.map(async task => {
          const { data: rejected } = await supabase
            .from('submissions')
            .select('*, reviews(*)')
            .eq('task_id', task.id)
            .eq('builder_id', currentUser.id)
            .eq('status', 'rejected')
            .order('submitted_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          return {
            ...task,
            rejectedFeedback: rejected?.reviews?.[0]?.feedback ?? null,
          }
        })
      )

      setMyTasks(tasksWithFeedback)
      setLoading(false)
    })
}, [currentUser])

  async function handleSubmit(taskId: string) {
    if (!currentUser) return setMessage('Please select a user first')
    const url = githubUrls[taskId]
    if (!url) return setMessage('Please enter a GitHub URL')
    try {
      await submitTask(taskId, currentUser.id, url, notes[taskId])
      setMessage('Submitted successfully')
      setMyTasks(myTasks.filter(t => t.id !== taskId))
    } catch (e: any) {
      setMessage(e.message)
    }
  }

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Submit Task</h1>
      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded">{message}</div>
      )}
      {myTasks.length === 0 ? (
        <p className="text-gray-500">No tasks to submit.</p>
      ) : (
        <div className="space-y-4">
          {myTasks.map(task => (
            <div key={task.id} className="border border-gray-200 rounded-lg p-5 bg-white">
              <h2 className="font-semibold text-lg">{task.title}</h2>
              <p className="text-gray-500 text-sm mt-1">{task.description}</p>
              {task.dod_criteria && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-2">
                  DoD: {task.dod_criteria}
                </p>
              )}
              {(task as any).rejectedFeedback && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                  <p className="text-xs font-bold text-red-600 mb-0.5">⚠ Rejected — Reviewer feedback:</p>
                  <p className="text-xs text-red-700">{(task as any).rejectedFeedback}</p>
                </div>
              )}
              <div className="mt-4 space-y-2">
                <input
                  type="text"
                  placeholder="GitHub URL"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  value={githubUrls[task.id] ?? ''}
                  onChange={e => setGithubUrls({ ...githubUrls, [task.id]: e.target.value })}
                />
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  value={notes[task.id] ?? ''}
                  onChange={e => setNotes({ ...notes, [task.id]: e.target.value })}
                />
                <button
                  onClick={() => handleSubmit(task.id)}
                  className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                >
                  Submit
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
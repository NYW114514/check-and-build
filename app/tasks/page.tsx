'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { getOpenTasks } from '../../lib/services/tasks'
import { enrollTask } from '../../lib/services/tasks'
import { Task } from '../../lib/types'
import { supabase } from '../../lib/supabase'

export default function TasksPage() {
  const { currentUser } = useUser()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }

    async function loadTasks() {
      const rawTasks = await getOpenTasks(currentUser!.role === 'l1' ? 'basic' : undefined)

      const tasksWithEnrollments = await Promise.all(
        rawTasks.map(async task => {
          const { data: enrollments } = await supabase
            .from('task_enrollments')
            .select('user_id')
            .eq('task_id', task.id)

          const enrolledIds = (enrollments ?? []).map(e => e.user_id)
          return {
            ...task,
            enrolledCount: enrolledIds.length,
            isEnrolled: enrolledIds.includes(currentUser!.id),
          }
        })
      )

      setTasks(tasksWithEnrollments)
      setLoading(false)
    }

    loadTasks().catch(console.error)
  }, [currentUser?.id, currentUser?.role])

  async function handleEnroll(taskId: string) {
    if (!currentUser) return setMessage('Please select a user first')
    try {
      await enrollTask(taskId, currentUser.id)
      setMessage('Enrolled successfully')
      setTasks(tasks.filter(t => t.id !== taskId))
    } catch (e: any) {
      setMessage(e.message)
    }
  }

  if (loading) return <div className="p-8">Loading tasks...</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Task Board</h1>
      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded">{message}</div>
      )}
      {tasks.length === 0 ? (
        <p className="text-gray-500">No open tasks available.</p>
      ) : (
        <div className="space-y-4">
          {tasks.map(task => (
            <div key={task.id} className="border border-gray-200 rounded-lg p-5 bg-white">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-lg">{task.title}</h2>
                  <p className="text-gray-500 text-sm mt-1">{task.description}</p>
                  <div className="flex gap-2 mt-2">
                    <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                      {task.difficulty}
                    </span>
                    <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700">
                      {task.point_value} pts
                    </span>
                  </div>
                </div>
                <div className="ml-4 flex flex-col items-end gap-1">
                  <span className="text-xs text-gray-400">
                    {(task as any).enrolledCount ?? 0}/{task.max_developers} enrolled
                  </span>
                  {(task as any).isEnrolled ? (
                    <span className="px-4 py-2 text-xs bg-green-100 text-green-700 rounded">
                      ✓ Enrolled
                    </span>
                  ) : (task as any).enrolledCount >= task.max_developers ? (
                    <span className="px-4 py-2 text-xs bg-gray-100 text-gray-400 rounded">
                      Full
                    </span>
                  ) : (
                    <button
                      onClick={() => handleEnroll(task.id)}
                      className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                    >
                      Enroll
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
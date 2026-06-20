'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { supabase } from '../../lib/supabase'
import { approveSubmission, rejectSubmission } from '../../lib/services/reviews'
import { Submission, Task } from '../../lib/types'

interface SubmissionWithTask extends Submission {
  task: Task | null
}

export default function ReviewPage() {
  const { currentUser } = useUser()
  const [submissions, setSubmissions] = useState<SubmissionWithTask[]>([])
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }

    async function loadSubmissions() {
      setLoading(true)

      const { data, error } = await supabase
        .from('submissions')
        .select('*, task:tasks!submissions_task_id_fkey(*), builder:users!submissions_builder_id_fkey(id, name, role)')
        .eq('status', 'pending')

      if (error) {
        setMessage(error.message)
        setSubmissions([])
      } else {
        const filtered = (data ?? []).filter((sub: any) => {
          if (currentUser?.role === 'l2') return sub.builder?.role === 'l1'
          if (currentUser?.role === 'l3') return ['l1', 'l2', 'l3'].includes(sub.builder?.role) && sub.builder?.id !== currentUser.id
          return false
        })
        setSubmissions(filtered as SubmissionWithTask[])
      }

      setLoading(false)
    }

    loadSubmissions()
  }, [currentUser])

  async function handleApprove(submissionId: string) {
    if (!currentUser) {
      setMessage('Please select a user first')
      return
    }

    try {
      await approveSubmission(submissionId, currentUser.id, feedback[submissionId])
      setMessage('Approved successfully')
      setSubmissions(prev => prev.filter(s => s.id !== submissionId))
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to approve submission')
    }
  }

  async function handleReject(submissionId: string) {
    if (!currentUser) {
      setMessage('Please select a user first')
      return
    }

    if (!feedback[submissionId]?.trim()) {
      setMessage('Feedback is required for rejection')
      return
    }

    try {
      await rejectSubmission(submissionId, currentUser.id, feedback[submissionId])
      setMessage('Rejected')
      setSubmissions(prev => prev.filter(s => s.id !== submissionId))
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reject submission')
    }
  }

  if (!currentUser) {
    return <div className="p-8 text-gray-500">Please select a user first.</div>
  }

  if (!['l2', 'l3'].includes(currentUser.role)) {
    return (
      <div className="p-8 text-red-500">
        Only L2/L3 reviewers can access this page.
      </div>
    )
  }

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Review Queue</h1>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded">
          {message}
        </div>
      )}

      {submissions.length === 0 ? (
        <p className="text-gray-500">No pending submissions.</p>
      ) : (
        <div className="space-y-4">
          {submissions.map(sub => (
            <div
              key={sub.id}
              className="border border-gray-200 rounded-lg p-5 bg-white"
            >
              <h2 className="font-semibold text-lg">
                {sub.task?.title ?? 'Untitled task'}
              </h2>

              <p className="text-gray-500 text-sm mt-1">
                {sub.task?.description ?? ''}
              </p>

              {sub.task?.dod_criteria && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-2">
                  DoD: {sub.task.dod_criteria}
                </p>
              )}

              <a
                href={sub.github_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 text-sm mt-2 block hover:underline"
              >
                {sub.github_url}
              </a>

              {sub.notes && (
                <p className="text-sm text-gray-600 mt-1">
                  Notes: {sub.notes}
                </p>
              )}

              <div className="mt-4 space-y-2">
                <input
                  type="text"
                  placeholder="Feedback (required for rejection)"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                  value={feedback[sub.id] ?? ''}
                  onChange={e =>
                    setFeedback(prev => ({
                      ...prev,
                      [sub.id]: e.target.value,
                    }))
                  }
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => handleApprove(sub.id)}
                    className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                  >
                    Approve
                  </button>

                  <button
                    onClick={() => handleReject(sub.id)}
                    className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
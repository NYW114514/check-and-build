'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { supabase } from '../../lib/supabase'
import { Submission, Task, Review } from '../../lib/types'
import { approveSubmission, rejectToBuilder } from '../../lib/services/reviews'

interface SubmissionWithTask extends Submission {
  task: Task | null
  builder_name?: string
  builder_role?: string
  reviews?: Review[]
}

export default function ReviewPage() {
  const { currentUser } = useUser()
  const [submissions, setSubmissions] = useState<SubmissionWithTask[]>([])
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [reviewerLink, setReviewerLink] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    loadSubmissions()
  }, [currentUser])

  async function loadSubmissions() {
    setLoading(true)
    // reset form state on reload
    setFeedback({})
    setReviewerLink({})

    const { data, error } = await supabase
      .from('submissions')
      .select('*, task:tasks!submissions_task_id_fkey(*), builder:users!submissions_builder_id_fkey(id, name, role)')
      .eq('status', 'pending')

    if (error) {
      setMessage(error.message)
      setSubmissions([])
      setLoading(false)
      return
    }

    // L2: all non-self submissions
    // L3: all non-self submissions
    // Both can review anyone
    const filtered = (data ?? []).filter((sub: any) => {
      if (!['l2', 'l3'].includes(currentUser?.role ?? '')) return false
      if (sub.builder?.id === currentUser?.id) return false
      // 如果 task 有 return_to_reviewer_id，只显示给指定人
      const returnToId = sub.task?.return_to_reviewer_id
      if (returnToId && returnToId !== currentUser?.id) return false
      return true
    })

    // fetch review history for each submission
    const enriched = await Promise.all(
      filtered.map(async (sub: any) => {
        const { data: reviews } = await supabase
          .from('reviews')
          .select('*')
          .eq('task_id', sub.task?.id)
          .order('reviewed_at', { ascending: true })

        return {
          ...sub,
          builder_name: sub.builder?.name,
          builder_role: sub.builder?.role,
          reviews: reviews ?? [],
        }
      })
    )

    setSubmissions(enriched as SubmissionWithTask[])
    setLoading(false)
  }

  async function handleApprove(submissionId: string) {
    if (!currentUser) return setMessage('Please select a user first')
    try {
      await approveSubmission(
        submissionId,
        currentUser.id,
        feedback[submissionId] || undefined,
        reviewerLink[submissionId] || undefined
      )
      setMessage('Approved — task moved to pending final approval')
      setFeedback(prev => { const n = { ...prev }; delete n[submissionId]; return n })
      setReviewerLink(prev => { const n = { ...prev }; delete n[submissionId]; return n })
      setSubmissions(prev => prev.filter(s => s.id !== submissionId))
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to approve')
    }
  }

  async function handleReject(submissionId: string) {
    if (!currentUser) return setMessage('Please select a user first')
    if (!feedback[submissionId]?.trim()) return setMessage('Feedback is required for rejection')
    try {
      await rejectToBuilder(
        submissionId,
        currentUser.id,
        feedback[submissionId],
        reviewerLink[submissionId] || undefined
      )
      setMessage('Rejected — task returned to developer')
      setFeedback(prev => { const n = { ...prev }; delete n[submissionId]; return n })
      setReviewerLink(prev => { const n = { ...prev }; delete n[submissionId]; return n })
      setSubmissions(prev => prev.filter(s => s.id !== submissionId))
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reject')
    }
  }

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (!['l2', 'l3'].includes(currentUser.role)) return <div className="p-8 text-red-500">Only L2/L3 reviewers can access this page.</div>
  if (loading) return <div className="p-8">Loading...</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Review Queue</h1>
      <p className="text-gray-500 text-sm mb-6">Initial review — approved tasks move to pending final approval.</p>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded flex justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      {submissions.length === 0 ? (
        <p className="text-gray-500">No pending submissions.</p>
      ) : (
        <div className="space-y-4">
          {submissions.map(sub => (
            <div key={sub.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h2 className="font-semibold text-lg">{sub.task?.title ?? 'Untitled task'}</h2>
                    <p className="text-xs text-gray-400">
                      Builder: {sub.builder_name ?? 'Unknown'} ({sub.builder_role})
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded bg-yellow-100 text-yellow-700">pending</span>
                </div>

                {sub.task?.description && (
                  <p className="text-gray-500 text-sm mb-2">{sub.task.description}</p>
                )}

                {sub.task?.dod_criteria && (
                  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mb-3">
                    DoD: {sub.task.dod_criteria}
                  </p>
                )}

                <a
                  href={sub.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 text-sm block hover:underline mb-1"
                >
                  {sub.github_url}
                </a>

                {sub.notes && (
                  <p className="text-sm text-gray-600 mb-3">Notes: {sub.notes}</p>
                )}

                {/* Review history */}
                {sub.reviews && sub.reviews.length > 0 && (
                  <div className="mb-4 border border-gray-100 rounded p-3 bg-gray-50">
                    <p className="text-xs font-bold text-gray-400 uppercase mb-2">Review History</p>
                    <div className="space-y-2">
                      {sub.reviews.map(r => (
                        <div key={r.id} className="text-xs">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded ${r.decision === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {r.decision}
                            </span>
                            <span className="text-gray-400">{r.review_stage}</span>
                            <span className="text-gray-400">{new Date(r.reviewed_at).toLocaleDateString()}</span>
                          </div>
                          {r.feedback && <p className="text-gray-600 mt-1">Comment: {r.feedback}</p>}
                          {r.reviewer_link && (
                            <a href={r.reviewer_link} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block mt-0.5">
                              Reviewer link: {r.reviewer_link}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Review form */}
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Comment (required for rejection)"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    value={feedback[sub.id] ?? ''}
                    onChange={e => setFeedback(prev => ({ ...prev, [sub.id]: e.target.value }))}
                  />
                  <input
                    type="text"
                    placeholder="Your link (optional — e.g. revised version)"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    value={reviewerLink[sub.id] ?? ''}
                    onChange={e => setReviewerLink(prev => ({ ...prev, [sub.id]: e.target.value }))}
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

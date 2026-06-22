'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../../lib/context/UserContext'
import { supabase } from '../../../lib/supabase'
import { Submission, Task, Review } from '../../../lib/types'
import { approveSubmission, finalApproveSubmission, rejectToBuilder, returnToInitialReviewer } from '../../../lib/services/reviews'

interface SubmissionWithDetails extends Submission {
  task: Task | null
  builder_name?: string
  builder_role?: string
  reviews?: (Review & { reviewer_name?: string })[]
}

export default function AdminReviewPage() {
  const { currentUser } = useUser()
  const [tab, setTab] = useState<'initial' | 'final'>('initial')
  const [initialSubmissions, setInitialSubmissions] = useState<SubmissionWithDetails[]>([])
  const [finalSubmissions, setFinalSubmissions] = useState<SubmissionWithDetails[]>([])
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
    setFeedback({})
    setReviewerLink({})

    try {
      const { data: initialData } = await supabase
        .from('submissions')
        .select('*, task:tasks!submissions_task_id_fkey(*), builder:users!submissions_builder_id_fkey(id, name, role)')
        .eq('status', 'pending')

      const { data: finalData } = await supabase
        .from('submissions')
        .select('*, task:tasks!submissions_task_id_fkey(*), builder:users!submissions_builder_id_fkey(id, name, role)')
        .eq('status', 'approved')
        .in('task.status', ['pending_final'])

      // For initial: all pending submissions
      const enrichedInitial = await enrichSubmissions(initialData ?? [])

      // For final: tasks in pending_final state
      const { data: pendingFinalTasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('status', 'pending_final')

      const pendingFinalTaskIds = (pendingFinalTasks ?? []).map((t: Task) => t.id)

      let enrichedFinal: SubmissionWithDetails[] = []
      if (pendingFinalTaskIds.length > 0) {
        const { data: finalSubs } = await supabase
          .from('submissions')
          .select('*, task:tasks!submissions_task_id_fkey(*), builder:users!submissions_builder_id_fkey(id, name, role)')
          .eq('status', 'approved')
          .in('task_id', pendingFinalTaskIds)

        enrichedFinal = await enrichSubmissions(finalSubs ?? [])
      }

      setInitialSubmissions(enrichedInitial)
      setFinalSubmissions(enrichedFinal)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function enrichSubmissions(data: any[]): Promise<SubmissionWithDetails[]> {
    return Promise.all(
      data.map(async (sub: any) => {
        const { data: reviews } = await supabase
          .from('reviews')
          .select('*')
          .eq('task_id', sub.task?.id)
          .order('reviewed_at', { ascending: true })

        const reviewsWithNames = await Promise.all(
          (reviews ?? []).map(async (r: Review) => {
            const { data: reviewer } = await supabase
              .from('users')
              .select('name')
              .eq('id', r.reviewer_id)
              .single()
            return { ...r, reviewer_name: reviewer?.name }
          })
        )

        return {
          ...sub,
          builder_name: sub.builder?.name,
          builder_role: sub.builder?.role,
          reviews: reviewsWithNames,
        }
      })
    )
  }

  async function handleInitialApprove(submissionId: string) {
    if (!currentUser) return
    try {
      await approveSubmission(
        submissionId,
        currentUser.id,
        feedback[submissionId] || undefined,
        reviewerLink[submissionId] || undefined
      )
      setMessage('Initial review approved — task moved to pending final approval')
      setInitialSubmissions(prev => prev.filter(s => s.id !== submissionId))
      clearForm(submissionId)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to approve')
    }
  }

  async function handleInitialReject(submissionId: string) {
    if (!currentUser) return
    if (!feedback[submissionId]?.trim()) return setMessage('Feedback is required for rejection')
    try {
      await rejectToBuilder(
        submissionId,
        currentUser.id,
        feedback[submissionId],
        reviewerLink[submissionId] || undefined
      )
      setMessage('Rejected — task returned to initial reviewer')
      setInitialSubmissions(prev => prev.filter(s => s.id !== submissionId))
      clearForm(submissionId)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reject')
    }
  }

  async function handleFinalApprove(submissionId: string) {
    if (!currentUser) return
    try {
      await finalApproveSubmission(
        submissionId,
        currentUser.id,
        feedback[submissionId] || undefined,
        reviewerLink[submissionId] || undefined
      )
      setMessage('Final approval complete — task approved')
      setFinalSubmissions(prev => prev.filter(s => s.id !== submissionId))
      clearForm(submissionId)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to approve')
    }
  }

  async function handleFinalReject(submissionId: string) {
    if (!currentUser) return
    if (!feedback[submissionId]?.trim()) return setMessage('Feedback is required for rejection')
    try {
      await returnToInitialReviewer(
        submissionId,
        currentUser.id,
        feedback[submissionId],
        reviewerLink[submissionId] || undefined
      )
      setMessage('Rejected — task returned to initial review')
      setFinalSubmissions(prev => prev.filter(s => s.id !== submissionId))
      clearForm(submissionId)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reject')
    }
  }

  function clearForm(submissionId: string) {
    setFeedback(prev => { const n = { ...prev }; delete n[submissionId]; return n })
    setReviewerLink(prev => { const n = { ...prev }; delete n[submissionId]; return n })
  }

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (currentUser.role !== 'admin') return <div className="p-8 text-red-500">Only admins can access this page.</div>
  if (loading) return <div className="p-8">Loading...</div>

  const currentList = tab === 'initial' ? initialSubmissions : finalSubmissions

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Admin Review</h1>
      <p className="text-gray-500 text-sm mb-6">Review task submissions at each stage.</p>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded flex justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('initial')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${
            tab === 'initial' ? 'bg-blue-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Pending Initial Review ({initialSubmissions.length})
        </button>
        <button
          onClick={() => setTab('final')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${
            tab === 'final' ? 'bg-teal-600 text-white' : 'border border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Pending Final Approval ({finalSubmissions.length})
        </button>
      </div>

      {currentList.length === 0 ? (
        <p className="text-gray-500">No submissions in this queue.</p>
      ) : (
        <div className="space-y-4">
          {currentList.map(sub => (
            <div key={sub.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h2 className="font-semibold text-lg">{sub.task?.title ?? 'Untitled task'}</h2>
                    <p className="text-xs text-gray-400">
                      Builder: {sub.builder_name ?? 'Unknown'} ({sub.builder_role})
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    tab === 'initial' ? 'bg-yellow-100 text-yellow-700' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {tab === 'initial' ? 'submitted' : 'pending_final'}
                  </span>
                </div>

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
                            <span className="text-gray-500">{(r as any).reviewer_name ?? 'Unknown'}</span>
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
                    placeholder="Your link (optional)"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    value={reviewerLink[sub.id] ?? ''}
                    onChange={e => setReviewerLink(prev => ({ ...prev, [sub.id]: e.target.value }))}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => tab === 'initial' ? handleInitialApprove(sub.id) : handleFinalApprove(sub.id)}
                      className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                    >
                      {tab === 'initial' ? 'Approve (Initial)' : 'Final Approve'}
                    </button>
                    <button
                      onClick={() => tab === 'initial' ? handleInitialReject(sub.id) : handleFinalReject(sub.id)}
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

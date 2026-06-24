'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { supabase } from '../../lib/supabase'
import { Project, Task } from '../../lib/types'
import { approveSubmission, returnToFinalReviewer, createProjectReview, rejectSubmission } from '../../lib/services/reviews'

interface TaskWithDetails extends Task {
  submissions?: {
    id: string
    github_url: string
    notes: string | null
    status: string
    builder_name?: string
    builder_id?: string
  }[]
  enrolledCount?: number
  review?: {
    decision: string
    feedback: string | null
    reviewer_link?: string | null
    reviewer_name?: string
  }
}

interface ProjectWithTasks extends Project {
  tasks: TaskWithDetails[]
  subscriber_name?: string
}

export default function AssemblyPage() {
  const { currentUser } = useUser()
  const [projects, setProjects] = useState<ProjectWithTasks[]>([])
  const [selectedProject, setSelectedProject] = useState<ProjectWithTasks | null>(null)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [feedback, setFeedback] = useState<Record<string, string>>({})
  const [reviewerLink, setReviewerLink] = useState<Record<string, string>>({})

  // project-level review form
  const [projectFeedback, setProjectFeedback] = useState('')
  const [projectReviewerLink, setProjectReviewerLink] = useState('')
  const [showProjectReviewForm, setShowProjectReviewForm] = useState(false)
  const [expiredTasks, setExpiredTasks] = useState<Record<string, boolean>>({})

  const [assemblyLink, setAssemblyLink] = useState('')

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    loadProjects()
  }, [currentUser?.id])

  async function loadProjects() {
    setLoading(true)
    try {
      const { data: allProjects } = await supabase
        .from('projects')
        .select('*')
        .in('status', ['active', 'in_review', 'ready_for_admin'])
        .order('created_at', { ascending: false })

      if (!allProjects) return

      // Only show projects owned by this L3 or unclaimed
      const filtered = allProjects.filter(p =>
        p.l3_owner_id === currentUser!.id || p.l3_owner_id === null
      )

      const enriched = await Promise.all(
        filtered.map(async project => {
          const { data: tasks } = await supabase
            .from('tasks')
            .select('*')
            .eq('project_id', project.id)

          const { data: subscriber } = await supabase
            .from('users')
            .select('name')
            .eq('id', project.subscriber_id)
            .single()

          const tasksWithDetails = await Promise.all(
            (tasks ?? []).map(async task => {
              const { data: submissions } = await supabase
                .from('submissions')
                .select('*')
                .eq('task_id', task.id)
                .in('status', ['pending', 'approved', 'rejected'])
                .order('submitted_at', { ascending: false })

              const { data: review } = await supabase
                .from('reviews')
                .select('*')
                .eq('task_id', task.id)
                .order('reviewed_at', { ascending: false })
                .limit(1)
                .maybeSingle()

              let reviewerName

              const submissionsWithNames = await Promise.all(
                (submissions ?? []).map(async sub => {
                  const { data: builder } = await supabase
                    .from('users')
                    .select('name')
                    .eq('id', sub.builder_id)
                    .single()

                  return {
                    id: sub.id,
                    github_url: sub.github_url,
                    notes: sub.notes,
                    status: sub.status,
                    builder_name: builder?.name,
                    builder_id: sub.builder_id,

                  }
                })
              )
              const { data: enrollments } = await supabase
                .from('task_enrollments')
                .select('user_id')
                .eq('task_id', task.id)

              if (review) {
                const { data: reviewer } = await supabase
                  .from('users').select('name').eq('id', review.reviewer_id).single()
                reviewerName = reviewer?.name
              }
              return {
                ...task,
                submissions: submissionsWithNames,
                enrolledCount: (enrollments ?? []).length,
                review: review ? {
                  decision: review.decision,
                  feedback: review.feedback,
                  reviewer_link: review.reviewer_link,
                  reviewer_name: reviewerName,
                } : undefined,
              }
            })
          )

          return {
            ...project,
            tasks: tasksWithDetails,
            subscriber_name: subscriber?.name,
          }
        })
      )

      setProjects(enriched)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleApproveTask(submissionId: string, taskId: string) {
    if (!currentUser) return
    const key = `${taskId}-${submissionId}`

    try {
      await approveSubmission(
        submissionId,
        currentUser.id,
        feedback[key] || undefined,
        reviewerLink[key] || undefined
      )

      setFeedback(prev => {
        const n = { ...prev }
        delete n[key]
        return n
      })

      setReviewerLink(prev => {
        const n = { ...prev }
        delete n[key]
        return n
      })

      setMessage('Task approved — moved to pending final approval')
      await refreshProject()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to approve')
    }
  }

  async function handleRejectTask(submissionId: string, taskId: string) {
    if (!currentUser) return
    const key = `${taskId}-${submissionId}`

    if (!feedback[key]) {
      return setMessage('Please provide feedback before rejecting')
    }

    try {
      await rejectSubmission(
        submissionId,
        currentUser.id,
        feedback[key],
        reviewerLink[key] || undefined,
        'initial'
      )

      setFeedback(prev => {
        const n = { ...prev }
        delete n[key]
        return n
      })

      setReviewerLink(prev => {
        const n = { ...prev }
        delete n[key]
        return n
      })

      setMessage('Task rejected, sent back to developer')
      await refreshProject()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reject')
    }
  }

  async function handleProjectReview(decision: 'approved' | 'rejected') {
    if (!currentUser || !selectedProject) return
    if (decision === 'rejected' && !projectFeedback.trim()) {
      return setMessage('Feedback is required when rejecting a project')
    }
    try {
      await createProjectReview(
        selectedProject.id,
        currentUser.id,
        'l3_initial',
        decision,
        projectFeedback || undefined,
        projectReviewerLink || undefined
      )
      setProjectFeedback('')
      setProjectReviewerLink('')
      setShowProjectReviewForm(false)
      setMessage(`Project ${decision === 'approved' ? 'approved' : 'rejected'} — review recorded`)
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to submit project review')
    }
  }

  async function refreshProject() {
    if (!selectedProject) return
    const { data: tasks } = await supabase
      .from('tasks')
      .select('*')
      .eq('project_id', selectedProject.id)

    const tasksWithDetails = await Promise.all(
      (tasks ?? []).map(async task => {
        const { data: submissions } = await supabase
          .from('submissions')
          .select('*')
          .eq('task_id', task.id)
          .in('status', ['pending', 'approved', 'rejected'])
          .order('submitted_at', { ascending: false })

        const { data: review } = await supabase
          .from('reviews')
          .select('*')
          .eq('task_id', task.id)
          .order('reviewed_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        let reviewerName

        const submissionsWithNames = await Promise.all(
          (submissions ?? []).map(async sub => {
            const { data: builder } = await supabase
              .from('users')
              .select('name')
              .eq('id', sub.builder_id)
              .single()

            return {
              id: sub.id,
              github_url: sub.github_url,
              notes: sub.notes,
              status: sub.status,
              builder_name: builder?.name,
              builder_id: sub.builder_id,

            }
          })
        )

        if (review) {
          const { data: reviewer } = await supabase
            .from('users').select('name').eq('id', review.reviewer_id).single()
          reviewerName = reviewer?.name
        }
        const { data: enrollments } = await supabase
          .from('task_enrollments')
          .select('user_id')
          .eq('task_id', task.id)

        return {
          ...task,
          submissions: submissionsWithNames,
          enrolledCount: (enrollments ?? []).length,
          review: review ? {
            decision: review.decision,
            feedback: review.feedback,
            reviewer_link: review.reviewer_link,
            reviewer_name: reviewerName,
          } : undefined,
        }
      })
    )

    const updatedProject = { ...selectedProject, tasks: tasksWithDetails }
    setSelectedProject(updatedProject)
    setProjects(prev => prev.map(p => p.id === selectedProject.id ? updatedProject : p))
  }

  function isTaskCompleteForAssembly(task: TaskWithDetails) {
    const enrolledCount = task.enrolledCount ?? 0
    const approvedCount = task.submissions?.filter(s => s.status === 'approved').length ?? 0

    return (
      (enrolledCount > 0 && approvedCount >= enrolledCount) ||
      task.l3_marked_expired ||
      expiredTasks[task.id]
    )
  }

  async function handleResetTaskToReview(taskId: string, comment?: string) {
    if (!selectedProject || !currentUser) return
    try {
      await returnToFinalReviewer(taskId, currentUser.id, comment)
      setMessage('Task returned to Admin final review')
      await refreshProject()
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to reset task')
    }
  }
  async function handleMarkReady() {
    if (!selectedProject) return

    if (!assemblyLink.trim()) {
      return setMessage('Please provide an assembly link before marking ready for admin')
    }
    const allComplete = selectedProject.tasks.length > 0 &&
      selectedProject.tasks.every(isTaskCompleteForAssembly)

    if (!allComplete) {
      return setMessage('All enrolled developers must have approved submissions, or the task must be marked as expired')
}

    try {
      const tasksToExpire = selectedProject.tasks.filter(t => expiredTasks[t.id] && !t.l3_marked_expired)
      if (tasksToExpire.length > 0) {
        await supabase
          .from('tasks')
          .update({ l3_marked_expired: true })
          .in('id', tasksToExpire.map(t => t.id))
      }
      await supabase
        .from('projects')
        .update({
          status: 'ready_for_admin',
          updated_at: new Date().toISOString(),
          admin_feedback: null,
          assembly_link: assemblyLink.trim(),
        })
        .eq('id', selectedProject.id)

      const taskCount = selectedProject.tasks.length
      await supabase.from('point_transactions').insert({
        user_id: currentUser!.id,
        project_id: selectedProject.id,
        type: 'assemble',
        amount: taskCount * 10,
        status: 'pending',
        description: `L3 assembly payout: ${taskCount} tasks × 10 pts`,
      })

      setMessage(`Project marked as ready for admin. You earned ${taskCount * 10} assembly points.`)
      const updated = { ...selectedProject, status: 'ready_for_admin' as const, admin_feedback: null }
      setSelectedProject(updated)
      setProjects(prev => prev.map(p => p.id === selectedProject.id ? updated : p))
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : 'Failed to update project')
    }
  }

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (currentUser.role !== 'l3') return <div className="p-8 text-red-500">Only L3 leads can access this page.</div>
  if (loading) return <div className="p-8">Loading...</div>

  const statusColors: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700',
    in_review: 'bg-yellow-100 text-yellow-700',
    ready_for_admin: 'bg-teal-100 text-teal-700',
  }

  const taskStatusColors: Record<string, string> = {
    open: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-blue-100 text-blue-700',
    submitted: 'bg-yellow-100 text-yellow-700',
    pending_final: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Assembly</h1>
      <p className="text-gray-500 text-sm mb-6">Review tasks and mark projects ready for admin deployment.</p>

      {message && (
        <div className="mb-4 p-3 bg-blue-50 text-blue-700 rounded flex justify-between">
          <span>{message}</span>
          <button onClick={() => setMessage('')} className="text-blue-400 hover:text-blue-600">✕</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">

        {/* Project List */}
        <div>
          <h2 className="font-semibold text-lg mb-3">Projects</h2>
          <div className="space-y-2">
            {projects.length === 0 && (
              <p className="text-gray-400 text-sm">No active projects.</p>
            )}
            {projects.map(p => {
              const allApproved = p.tasks.length > 0 && p.tasks.every(isTaskCompleteForAssembly)
              const isOwner = p.l3_owner_id === currentUser.id
              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelectedProject(p)
                    setShowProjectReviewForm(false)
                    setAssemblyLink(p.assembly_link ?? '')
                  }}
                  className={`border rounded-lg p-3 cursor-pointer hover:border-blue-400 ${
                    selectedProject?.id === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="font-medium text-sm">{p.title}</div>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColors[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {p.status}
                    </span>
                    {isOwner && (
                      <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">Owner</span>
                    )}
                    {allApproved && p.status !== 'ready_for_admin' && (
                      <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">✓ ready</span>
                    )}
                    {p.admin_feedback && (
                      <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">⚠ sent back</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {p.tasks.filter(isTaskCompleteForAssembly).length}/{p.tasks.length} tasks ready
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Project Detail */}
        <div className="col-span-2">
          {!selectedProject ? (
            <p className="text-gray-500">Select a project to review.</p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-semibold text-lg">{selectedProject.title}</h2>
                  <div className="flex gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded ${statusColors[selectedProject.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {selectedProject.status}
                    </span>
                    {selectedProject.subscriber_name && (
                      <span className="text-xs text-gray-400">Subscriber: {selectedProject.subscriber_name}</span>
                    )}
                  </div>
                  {selectedProject.admin_feedback && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
                      <p className="text-xs font-bold text-red-600 mb-0.5">⚠ Sent back by Admin:</p>
                      <p className="text-xs text-red-700">{selectedProject.admin_feedback}</p>
                    </div>
                  )}
                </div>
                {selectedProject.status !== 'ready_for_admin' && (
                  <div className="flex gap-2 items-center">
                    <input
                      type="text"
                      placeholder="Assembly link for Admin"
                      className="border border-gray-300 rounded px-3 py-2 text-sm"
                      value={assemblyLink}
                      onChange={e => setAssemblyLink(e.target.value)}
                    />
                    <button
                      onClick={handleMarkReady}
                      className="px-4 py-2 bg-teal-600 text-white text-sm rounded hover:bg-teal-700"
                    >
                      ✓ Mark Ready for Admin
                    </button>
                  </div>
                )}
                {selectedProject.status === 'ready_for_admin' && (
                  <span className="text-sm text-teal-600 font-medium">✓ Submitted to Admin</span>
                )}
              </div>

              {/* Project-level review form */}
              {selectedProject.l3_owner_id === currentUser.id && (
                <div className="mb-4 border border-purple-200 rounded-lg bg-purple-50 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-purple-700">L3 Project Review</p>
                    <button
                      onClick={() => setShowProjectReviewForm(!showProjectReviewForm)}
                      className="text-xs text-purple-600 hover:underline"
                    >
                      {showProjectReviewForm ? 'Hide' : 'Submit Review'}
                    </button>
                  </div>
                  {showProjectReviewForm && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        placeholder="Comment (required for rejection)"
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        value={projectFeedback}
                        onChange={e => setProjectFeedback(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="Your link (optional)"
                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                        value={projectReviewerLink}
                        onChange={e => setProjectReviewerLink(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleProjectReview('approved')}
                          className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                        >
                          Approve Project
                        </button>
                        <button
                          onClick={() => handleProjectReview('rejected')}
                          className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                        >
                          Reject Project
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Task list */}
              <div className="space-y-3">
                {selectedProject.tasks.map(task => (
                  <div key={task.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
                    <div className="px-4 py-3 flex items-start justify-between">
                      <div>
                        <span className="font-medium text-sm">{task.title}</span>
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                          task.difficulty === 'advanced' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                        }`}>{task.difficulty}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded ${taskStatusColors[task.status]}`}>
                        {task.status}
                      </span>
                    </div>

                    {task.dod_criteria && (
                      <div className="px-4 pb-2">
                        <p className="text-xs text-amber-700">DoD: {task.dod_criteria}</p>
                      </div>
                    )}

                    {task.due_at && (
                      <div className="px-4 pb-2 flex gap-4 text-xs text-gray-400">
                        <span>Started: {new Date(task.first_enrolled_at!).toLocaleDateString()}</span>
                        <span>Due: {new Date(task.due_at).toLocaleDateString()}</span>
                      </div>
                    )}

                    {task.submissions && task.submissions.length > 0 && (
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">
                          Submissions ({task.submissions.length})
                        </p>
                        {task.submissions.map(sub => (
                          <div key={sub.id} className="mb-2 pb-2 border-b border-gray-100 last:border-0 last:mb-0 last:pb-0">
                            <p className="text-xs text-gray-600">
                              Builder: {sub.builder_name ?? 'Unknown'} · 
                              <span className={sub.status === 'approved' ? 'text-green-600' : 'text-amber-600'}>
                                {sub.status}
                              </span>
                            </p>
                            <a
                              href={sub.github_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline block mt-0.5"
                            >
                              {sub.github_url}
                            </a>
                            {sub.notes && (
                              <p className="text-xs text-gray-500 mt-0.5">Notes: {sub.notes}</p>
                            )}

                          </div>
                        ))}
                      </div>
                    )}
                    {task.submissions?.some(sub => sub.status === 'approved') && (
                      <div className="px-4 py-2 border-t border-gray-100 bg-white space-y-2">
                        <input
                          type="text"
                          placeholder="Comment for Admin (optional)"
                          className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                          value={feedback[`reset-${task.id}`] ?? ''}
                          onChange={e =>
                            setFeedback(prev => ({
                              ...prev,
                              [`reset-${task.id}`]: e.target.value,
                            }))
                          }
                        />
                        <button
                          onClick={() =>
                            handleResetTaskToReview(task.id, feedback[`reset-${task.id}`] || undefined)
                          }
                          className="text-xs px-3 py-1.5 border border-orange-200 text-orange-600 rounded hover:bg-orange-50"
                        >
                          ↺ Return task to Admin Review
                        </button>
                      </div>
                    )}

                    {/* {task.review && (
                      <div className="px-4 py-2 bg-green-50 border-t border-gray-100">
                        <p className="text-xs font-bold text-gray-400 uppercase mb-1">Previous Review</p>
                        <p className="text-xs text-gray-600">Reviewer: {task.review.reviewer_name ?? 'Unknown'}</p>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          task.review.decision === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                        }`}>
                          {task.review.decision}
                        </span>
                        {task.review.feedback && (
                          <p className="text-xs text-gray-500 mt-1">Comment: {task.review.feedback}</p>
                        )}
                        {task.review.reviewer_link && (
                          <a href={task.review.reviewer_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline block mt-0.5">
                            Reviewer link: {task.review.reviewer_link}
                          </a>
                        )}
                      </div>
                    )} */}

                    {task.submissions && task.submissions
                      .filter(sub => sub.status === 'pending' && sub.builder_id !== currentUser.id)
                      .map(sub => (
                        <div key={sub.id} className="px-4 py-3 border-t border-gray-100 bg-white">
                          <p className="text-xs text-gray-500 mb-2">Review: {sub.builder_name ?? 'Unknown'}</p>
                          <input
                            type="text"
                            placeholder="Comment (required for rejection)"
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-2"
                            value={feedback[`${task.id}-${sub.id}`] ?? ''}
                            onChange={e => setFeedback(prev => ({ ...prev, [`${task.id}-${sub.id}`]: e.target.value }))}
                          />
                          <input
                            type="text"
                            placeholder="Your link (optional)"
                            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-2"
                            value={reviewerLink[`${task.id}-${sub.id}`] ?? ''}
                            onChange={e => setReviewerLink(prev => ({ ...prev, [`${task.id}-${sub.id}`]: e.target.value }))}
                          />
                          <div className="flex gap-2">
                            <button
                              
                              onClick={() => handleApproveTask(sub.id, task.id)}
                              className="px-4 py-2 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => handleRejectTask(sub.id, task.id)}
                              className="px-4 py-2 bg-red-500 text-white text-sm rounded hover:bg-red-600"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ))
                    }

                    {!task.l3_marked_expired && (() => {
                      const enrolledCount = task.enrolledCount ?? 0
                      const approvedCount = task.submissions?.filter(s => s.status === 'approved').length ?? 0
                      return enrolledCount > 0 && approvedCount < enrolledCount
                    })() && (
                      <div className="px-4 py-2 border-t border-gray-100 bg-white flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`expired-${task.id}`}
                          checked={expiredTasks[task.id] ?? false}
                          onChange={e => setExpiredTasks(prev => ({ ...prev, [task.id]: e.target.checked }))}
                        />
                        <label htmlFor={`expired-${task.id}`} className="text-xs text-gray-500 cursor-pointer">
                          Mark as expired (simulate due date reached)
                        </label>
                      </div>
                    )}
                    {task.l3_marked_expired && (
                      <div className="px-4 py-2 border-t border-gray-100 bg-amber-50">
                        <span className="text-xs text-amber-600">⚠ Marked as expired</span>
                      </div>
                    )}

                    {(!task.submissions || task.submissions.length === 0) && (
                      <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                        <p className="text-xs text-gray-400 italic">No submission yet</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

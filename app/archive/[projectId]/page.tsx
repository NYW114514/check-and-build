'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../../lib/context/UserContext'
import { supabase } from '../../../lib/supabase'
import { useParams } from 'next/navigation'

interface ReviewRecord {
  id: string
  reviewer_name?: string
  decision: string
  feedback: string | null
  reviewer_link: string | null
  review_stage: string
  reviewed_at: string
}

interface TaskRecord {
  id: string
  title: string
  description: string | null
  dod_criteria: string | null
  difficulty: string
  status: string
  point_value: number
  submissions: {
    id: string
    github_url: string
    notes: string | null
    status: string
    builder_name?: string
    builder_id?: string
  }[]
  reviews: ReviewRecord[]
}

interface ProjectReviewRecord {
  id: string
  reviewer_name?: string
  stage: string
  decision: string
  feedback: string | null
  reviewer_link: string | null
  reviewed_at: string
}

interface ArchiveData {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  contact_email: string | null
  final_link: string | null
  final_comment: string | null
  created_at: string
  subscriber_name?: string
  intake_payload: Record<string, unknown> | null
  tasks: TaskRecord[]
  project_reviews: ProjectReviewRecord[]
}

export default function ArchivePage() {
  const { currentUser } = useUser()
  const params = useParams()
  const projectId = params?.projectId as string
  const [data, setData] = useState<ArchiveData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPayload, setShowPayload] = useState(false)

  useEffect(() => {
    if (!currentUser || !projectId) { setLoading(false); return }
    loadArchive()
  }, [currentUser?.id, projectId])

  async function loadArchive() {
    setLoading(true)
    try {
      const { data: project } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single()

      if (!project) return

      const { data: subscriber } = await supabase
        .from('users')
        .select('name')
        .eq('id', project.subscriber_id)
        .single()

      const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true })

      const tasksWithDetails = await Promise.all(
        (tasks ?? []).map(async task => {
          const { data: submissions } = await supabase
            .from('submissions')
            .select('*')
            .eq('task_id', task.id)
            .order('submitted_at', { ascending: true })

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
          const { data: reviews } = await supabase
            .from('reviews')
            .select('*')
            .eq('task_id', task.id)
            .order('reviewed_at', { ascending: true })

          const reviewsWithNames = await Promise.all(
            (reviews ?? []).map(async r => {
              const { data: reviewer } = await supabase
                .from('users').select('name').eq('id', r.reviewer_id).single()
              return { ...r, reviewer_name: reviewer?.name }
            })
          )

          return {
            id: task.id,
            title: task.title,
            description: task.description,
            dod_criteria: task.dod_criteria,
            difficulty: task.difficulty,
            status: task.status,
            point_value: task.point_value,
            submissions: submissionsWithNames,
            reviews: reviewsWithNames,
          }
        })
      )

      const { data: projectReviews } = await supabase
        .from('project_reviews')
        .select('*')
        .eq('project_id', projectId)
        .order('reviewed_at', { ascending: true })

      const projectReviewsWithNames = await Promise.all(
        (projectReviews ?? []).map(async r => {
          const { data: reviewer } = await supabase
            .from('users').select('name').eq('id', r.reviewer_id).single()
          return { ...r, reviewer_name: reviewer?.name }
        })
      )

      setData({
        ...project,
        subscriber_name: subscriber?.name,
        tasks: tasksWithDetails,
        project_reviews: projectReviewsWithNames,
      })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (!currentUser) return <div className="p-8 text-gray-500">Please select a user first.</div>
  if (loading) return <div className="p-8">Loading...</div>
  if (!data) return <div className="p-8 text-red-500">Project not found.</div>

  return (
    <div className="p-8 max-w-4xl mx-auto">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">{data.title}</h1>
          <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-700 font-medium">
            {data.status}
          </span>
          <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700">
            {data.priority}
          </span>
        </div>
        {data.description && (
          <p className="text-gray-600 text-sm mb-2">{data.description}</p>
        )}
        <div className="flex gap-6 text-xs text-gray-400">
          {data.subscriber_name && <span>Subscriber: {data.subscriber_name}</span>}
          {data.contact_email && <span>Contact: {data.contact_email}</span>}
          <span>Created: {new Date(data.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Admin final record */}
      {(data.final_link || data.final_comment) && (
        <div className="mb-6 border border-teal-200 rounded-lg p-4 bg-teal-50">
          <p className="text-xs font-bold text-teal-700 uppercase mb-2">Admin Final Record</p>
          {data.final_comment && (
            <p className="text-sm text-gray-700 mb-1">Comment: {data.final_comment}</p>
          )}
          {data.final_link && (
            <a href={data.final_link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline">
              Final link: {data.final_link}
            </a>
          )}
        </div>
      )}

      {/* Project reviews */}
      {data.project_reviews.length > 0 && (
        <div className="mb-6">
          <h2 className="font-semibold text-lg mb-3">Project Review History</h2>
          <div className="space-y-2">
            {data.project_reviews.map(r => (
              <div key={r.id} className="border border-gray-200 rounded-lg p-3 bg-white">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded ${r.decision === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {r.decision}
                  </span>
                  <span className="text-xs text-gray-600">{r.reviewer_name ?? 'Unknown'}</span>
                  <span className="text-xs text-gray-400">{r.stage}</span>
                  <span className="text-xs text-gray-400">{new Date(r.reviewed_at).toLocaleDateString()}</span>
                </div>
                {r.feedback && <p className="text-xs text-gray-600">Comment: {r.feedback}</p>}
                {r.reviewer_link && (
                  <a href={r.reviewer_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline block">
                    Reviewer link: {r.reviewer_link}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks */}
      <h2 className="font-semibold text-lg mb-3">Tasks ({data.tasks.length})</h2>
      <div className="space-y-4 mb-6">
        {data.tasks.map(task => (
          <div key={task.id} className="border border-gray-200 rounded-lg bg-white overflow-hidden">
            <div className="px-4 py-3 flex items-start justify-between">
              <div>
                <span className="font-medium text-sm">{task.title}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                  task.difficulty === 'advanced' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                }`}>{task.difficulty}</span>
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">
                  {task.point_value} pts
                </span>
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">{task.status}</span>
            </div>

            {task.dod_criteria && (
              <div className="px-4 pb-2">
                <p className="text-xs text-amber-700">DoD: {task.dod_criteria}</p>
              </div>
            )}

            {/* Submissions */}
            {task.submissions.length > 0 && (
              <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase mb-1">
                  Submissions ({task.submissions.length})
                </p>

                <div className="space-y-2">
                  {task.submissions.map(sub => (
                    <div
                      key={sub.id}
                      className="pb-2 border-b border-gray-100 last:border-0 last:pb-0"
                    >
                      <p className="text-xs text-gray-600">
                        Builder: {sub.builder_name ?? 'Unknown'} · {sub.status}
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
              </div>
            )}

            {/* Review history */}
            {task.reviews.length > 0 && (
              <div className="px-4 py-2 border-t border-gray-100">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Review History</p>
                <div className="space-y-2">
                  {task.reviews.map(r => (
                    <div key={r.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded ${r.decision === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                          {r.decision}
                        </span>
                        <span className="text-gray-600">{r.reviewer_name ?? 'Unknown'}</span>
                        <span className="text-gray-400">{r.review_stage}</span>
                        <span className="text-gray-400">{new Date(r.reviewed_at).toLocaleDateString()}</span>
                      </div>
                      {r.feedback && <p className="text-gray-600 mt-0.5">Comment: {r.feedback}</p>}
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
          </div>
        ))}
      </div>

      {/* Intake payload */}
      {data.intake_payload && (
        <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
          <button
            onClick={() => setShowPayload(!showPayload)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm text-gray-500 hover:bg-gray-50"
          >
            <span>Original Intake Payload</span>
            <span>{showPayload ? '▲' : '▼'}</span>
          </button>
          {showPayload && (
            <div className="border-t border-gray-100 p-4">
              <pre className="text-xs text-gray-600 overflow-auto bg-gray-50 rounded p-3 max-h-64">
                {JSON.stringify(data.intake_payload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

    </div>
  )
}

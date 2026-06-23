'use client'

import { useState, useRef, useEffect } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { createProject } from '../../lib/services/projects'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface IntakePayload {
  project_title?: string
  primary_business_goal?: string
  urgency_level?: 'standard' | 'high' | 'critical'
  ui_specs?: {
    visual_layout?: string
    required_inputs?: string[]
    required_outputs?: string[]
  }
  data_pipeline_specs?: {
    data_sources?: string[]
    data_frequency?: string
    preprocessing_needs?: string[]
  }
  core_logic_specs?: {
    primary_operations?: string[]
    business_rules?: string[]
  }
  ai_complexity_estimate?: {
    difficulty?: string
    suggested_task_count?: number
    reasoning?: string
  }
}

function ArrayField({ items }: { items?: string[] }) {
  if (!items || items.length === 0) {
    return <p className="text-gray-400 text-sm italic">Not specified</p>
  }
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-gray-700 flex gap-2">
          <span className="text-gray-300 mt-0.5">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm text-gray-700">{value || <span className="text-gray-400 italic">Not specified</span>}</p>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-lg bg-white p-5">
      <h3 className="font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-100">{title}</h3>
      <div className="space-y-4">{children}</div>
    </div>
  )
}

function UrgencyBadge({ level }: { level?: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-amber-100 text-amber-700',
    standard: 'bg-gray-100 text-gray-600',
  }
  const style = styles[level ?? 'standard'] ?? styles.standard
  return (
    <span className={`text-xs px-2 py-1 rounded font-medium ${style}`}>
      {level ?? 'standard'}
    </span>
  )
}

export default function IntakePage() {
  const { currentUser } = useUser()
  const router = useRouter()
  const bottomRef = useRef<HTMLDivElement>(null)

  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm your Technical Product Manager. Tell me about the financial tool you'd like to build — what problem are you trying to solve?",
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [payload, setPayload] = useState<IntakePayload | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [showRawJSON, setShowRawJSON] = useState(false)
  const [error, setError] = useState('')
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [userNotes, setUserNotes] = useState('')

  const userMessageCount = messages.filter(m => m.role === 'user').length

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const ext = file.name.split('.').pop()?.toLowerCase()

    if (ext === 'pdf') {
      setError('PDF support coming soon. Please upload a .txt or .docx file.')
      e.target.value = ''
      return
    }

    if (ext !== 'txt' && ext !== 'docx') {
      setError('Unsupported file type. Please upload .txt or .docx.')
      e.target.value = ''
      return
    }

    try {
      setLoading(true)
      let text = ''

      if (ext === 'txt') {
        text = await file.text()
        if (text.length > 20000) {
          text = text.slice(0, 20000)
          setError('Document truncated to 20,000 characters.')
        }
      } else if (ext === 'docx') {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/extract-document', {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)
        text = data.text
        if (data.truncated) setError('Document truncated to 20,000 characters.')
      }

      const userMessage = `[Uploaded document: ${file.name}. ]\n\n${text}`
      const updatedMessages = [...messages, { role: 'user' as const, content: userMessage }]
      setMessages(updatedMessages)
      setUploadedFileName(file.name)

      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'chat', messages: updatedMessages }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to process file')
    } finally {
      setLoading(false)
      e.target.value = ''
    }
  }

  async function handleSend() {
    if (!input.trim() || loading) return
    const userMessage: Message = { role: 'user', content: input }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput('')
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'chat',
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate() {
    setGenerating(true)
    setError('')
    try {
      const res = await fetch('/api/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'generate_payload',
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      if (data.payload) setPayload(data.payload)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate payload')
    } finally {
      setGenerating(false)
    }
  }

  async function handleConfirm() {
    if (!payload || !currentUser) return
    setError('')
    try {
      await createProject({
        title: payload.project_title ?? 'Untitled Project',
        description: payload.primary_business_goal ?? '',
        subscriber_id: currentUser.id,
        main_contact_id: null,
        priority: payload.urgency_level ?? 'standard',
        status: 'pending',
        intake_payload: {
          ...(payload as Record<string, unknown>),
          user_notes: userNotes || null,
        },
        admin_feedback: null,
        contact_email: null,
        l3_owner_id: null,
        final_link: null,
        final_comment: null,
      })
      setSubmitted(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit project')
    }
  }

  if (!currentUser) {
    return <div className="p-8 text-gray-500">Please select a user first.</div>
  }

  if (currentUser.role !== 'subscriber') {
    return <div className="p-8 text-red-500">Only subscribers can submit project requests.</div>
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-64px)]">
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-2xl font-bold mb-2">Request Submitted</h1>
        <p className="text-gray-500 mb-6 text-center max-w-md">
          Your project has been sent to the Checkit team. You can track its status from your dashboard.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Home
          </button>
          <button
            onClick={() => {
              setSubmitted(false)
              setPayload(null)
              setMessages([{
                role: 'assistant',
                content: "Hi! I'm your Technical Product Manager. Tell me about the financial tool you'd like to build — what problem are you trying to solve?",
              }])
              setInput('')
              setUserNotes('')
            }}
            className="px-6 py-2 border border-gray-300 text-gray-600 rounded hover:bg-gray-50"
          >
            Submit Another Request
          </button>
        </div>
      </div>
    )
  }
  // Payload preview
  if (payload) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-8 py-8">
          <h1 className="text-2xl font-bold mb-1">Review Your Requirements</h1>
          <p className="text-gray-500 text-sm mb-6">
            Please review what we captured before submitting to the admin team.
          </p>

          {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">{error}</div>}

          <div className="space-y-4">

            {/* Card 1: Project Summary */}
            <Card title="Project Summary">
              <Field label="Project Title" value={payload.project_title} />
              <Field label="Business Goal" value={payload.primary_business_goal} />
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Urgency</p>
                <UrgencyBadge level={payload.urgency_level} />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Status</p>
                <span className="text-xs px-2 py-1 rounded font-medium bg-blue-100 text-blue-700">
                  Ready to Submit
                </span>
              </div>
            </Card>

            {/* Card 2: UI Specs */}
            <Card title="UI & Interaction">
              <Field label="Layout" value={payload.ui_specs?.visual_layout} />
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Inputs</p>
                <ArrayField items={payload.ui_specs?.required_inputs} />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Outputs</p>
                <ArrayField items={payload.ui_specs?.required_outputs} />
              </div>
            </Card>

            {/* Card 3: Data Pipeline */}
            <Card title="Data Pipeline">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Data Sources</p>
                <ArrayField items={payload.data_pipeline_specs?.data_sources} />
              </div>
              <Field label="Refresh Frequency" value={payload.data_pipeline_specs?.data_frequency} />
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Preprocessing</p>
                <ArrayField items={payload.data_pipeline_specs?.preprocessing_needs} />
              </div>
            </Card>

            {/* Card 4: Core Logic */}
            <Card title="Core Logic">
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Primary Operations</p>
                <ArrayField items={payload.core_logic_specs?.primary_operations} />
              </div>
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Financial Rules</p>
                <ArrayField items={payload.core_logic_specs?.business_rules} />
              </div>
            </Card>

            {/* Card 5: Complexity Estimate */}
            <Card title="Complexity Estimate">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Difficulty</p>
                  <span className={`text-xs px-2 py-1 rounded font-medium ${
                    payload.ai_complexity_estimate?.difficulty === 'advanced'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {payload.ai_complexity_estimate?.difficulty ?? 'basic'}
                  </span>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Suggested Tasks</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {payload.ai_complexity_estimate?.suggested_task_count ?? '—'}
                  </p>
                </div>
              </div>
              <Field label="Reasoning" value={payload.ai_complexity_estimate?.reasoning} />
            </Card>

            {/* Collapsed raw JSON */}
            <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
              <button
                onClick={() => setShowRawJSON(!showRawJSON)}
                className="w-full px-5 py-3 flex items-center justify-between text-sm text-gray-500 hover:bg-gray-50"
              >
                <span>Advanced: View raw JSON payload for admin/debug</span>
                <span>{showRawJSON ? '▲' : '▼'}</span>
              </button>
              {showRawJSON && (
                <div className="border-t border-gray-100 p-4">
                  <pre className="text-xs text-gray-600 overflow-auto bg-gray-50 rounded p-4 max-h-64">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="border border-gray-200 rounded-lg bg-white p-5">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Additional Notes (optional)</p>
              <textarea
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                rows={3}
                placeholder="Any additional context or requirements you'd like to add..."
                value={userNotes}
                onChange={e => setUserNotes(e.target.value)}
              />
            </div>

          </div>

          {/* Buttons */}
          <div className="flex gap-3 mt-6 pb-8">
            <button
              onClick={handleConfirm}
              className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              Confirm & Submit to Admin
            </button>
            <button
              onClick={() => setPayload(null)}
              className="px-6 py-2.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              Go Back & Edit
            </button>
          </div>

        </div>
      </div>
    )
  }

  // Chat view
  return (
    <div className="flex flex-col h-[calc(100vh-64px)] p-8">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Request a Custom Tool</h1>
        <p className="text-gray-500 text-sm">Describe what you need and our AI will help structure your requirements.</p>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">{error}</div>}

      <div className="flex-1 border border-gray-200 rounded-lg bg-white overflow-y-auto p-4 space-y-4 mb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[70%] px-4 py-3 rounded-lg text-base ${
              msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-800'
            }`}>
              {msg.role === 'user' ? (
                msg.content.startsWith('[Uploaded document:') ? (
                  <span className="text-sm">📎 {msg.content.split('\n')[0].replace('[', '').replace(']', '')}</span>
                ) : (
                  msg.content
                )
              ) : (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-400 px-4 py-3 rounded-lg text-sm animate-pulse">Thinking...</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mb-2 flex items-center gap-3">
        <label className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          <span>📎 Upload document (.txt, .docx)</span>
          <input
            type="file"
            accept=".txt,.docx,.pdf"
            className="hidden"
            onChange={handleFileUpload}
            disabled={loading}
          />
        </label>
        {uploadedFileName && (
          <span className="text-xs text-green-600">✓ {uploadedFileName}</span>
        )}
      </div>

      {userMessageCount >= 2 && (
        <div className="mb-3 flex items-center gap-3">
          <p className="text-sm text-gray-500">Feel free to share more, or generate your project spec when ready.</p>
          <button
            onClick={handleGenerate}
            disabled={generating || loading}
            className="shrink-0 px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
          >
            {generating ? 'Generating...' : '✦ Generate Spec'}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Describe your requirements..."
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-base"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          disabled={loading}
        />
        <button
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="px-5 py-2.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          Send
        </button>
      </div>
    </div>
  )
}

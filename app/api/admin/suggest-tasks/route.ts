import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.fireworks.ai/inference/v1',
})

const SUGGEST_TASKS_PROMPT = `You are a senior technical project manager for Checkit Analytics, a financial analytics platform.

Your job is to generate task drafts for a software project based on a standardized requirements payload (intake_payload).

PLATFORM RULES:
- Developers are categorized as L1, L2, or L3.
- L1: junior developers. Suitable for isolated frontend UI components, static layouts, mock data display. No backend, no API, no complex logic.
- L2: mid-level developers. Suitable for frontend with state management, form handling, basic API calls, standard frontend-backend integration.
- L3: senior developers. Suitable for complex data pipelines, AI/LLM integration, third-party API integration, scoring/ranking algorithms, database schema, cross-module integration, architecture decisions.

DIFFICULTY RULES:
- basic: pure UI, mock data, isolated component, no complex logic, no real API integration.
- advanced: requires backend, real API, database, AI/LLM, complex calculation, third-party integration, or cross-module coordination.

POINT VALUE RULES:
- 10 pts: basic task
- 20 pts: standard advanced task
- 30 pts: complex advanced task (AI pipeline, multi-source integration, complex algorithm)

TASK COUNT RULES:
- Use suggested_task_count from ai_complexity_estimate as a guide.
- Adjust based on functional_modules and technical_components if available.
- Range: 3-8 tasks total.
- Do not go below 3 or above 8.

IMPORTANT:
- Do NOT copy task divisions from the source document blindly.
- Derive task drafts from the standardized intake payload only.
- Each task must be independently deliverable.
- Prefer parallel tasks where possible.
- Do not generate assigned_to or specific user assignments.
- Return valid JSON only, no markdown, no explanation before or after.

OUTPUT FORMAT (JSON array):
[
  {
    "title": "string - concise task title",
    "description": "string - what needs to be built",
    "dod_criteria": "string - definition of done, 2-4 bullet points separated by newlines",
    "difficulty": "basic" or "advanced",
    "point_value": 10 or 20 or 30,
    "recommended_role": "l1" or "l2" or "l3",
    "category": "frontend" or "backend" or "data" or "ai" or "integration" or "design"
  }
]`

export async function POST(req: NextRequest) {
  try {
    const { intake_payload, existing_tasks } = await req.json()

    if (!intake_payload) {
      return NextResponse.json({ error: 'intake_payload is required' }, { status: 400 })
    }

    const userMessage = `Generate task drafts for this project.

Intake Payload:
${JSON.stringify(intake_payload, null, 2)}

${existing_tasks && existing_tasks.length > 0 ? `Existing tasks already created (do not duplicate):
${existing_tasks.map((t: any) => `- ${t.title}`).join('\n')}` : ''}

Generate the task drafts now.`

    const response = await client.chat.completions.create({
      model: process.env.FIREWORKS_MODEL ?? 'accounts/fireworks/models/gpt-oss-120b',
      messages: [
        { role: 'system', content: SUGGEST_TASKS_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    })

    const content = response.choices[0].message.content ?? ''
    const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim()

    try {
      const suggestions = JSON.parse(cleaned)
      return NextResponse.json({ suggestions })
    } catch {
      return NextResponse.json(
        { error: 'Failed to generate valid suggestions. Please try again.' },
        { status: 422 }
      )
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'API error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

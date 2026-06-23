import { NextRequest, NextResponse } from 'next/server'
import mammoth from 'mammoth'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const result = await mammoth.extractRawText({ buffer })
    let text = result.value

    if (text.length > 20000) {
      text = text.slice(0, 20000)
      return NextResponse.json({ text, truncated: true })
    }

    return NextResponse.json({ text, truncated: false })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to extract document'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
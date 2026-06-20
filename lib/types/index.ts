export type Role = 'subscriber' | 'admin' | 'l1' | 'l2' | 'l3'

export type ProjectStatus =
  | 'pending'
  | 'active'
  | 'in_review'
  | 'ready_for_admin'
  | 'pending_deployment'
  | 'finished'

export type TaskStatus = 'open' | 'in_progress' | 'submitted' | 'approved'

export type Difficulty = 'basic' | 'advanced'

export type SubmissionStatus = 'pending' | 'approved' | 'rejected'

export type PointType = 'build' | 'review' | 'assemble'

export type PointStatus = 'pending' | 'earned' | 'cancelled'

export type Priority = 'standard' | 'high' | 'critical'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  total_points: number
  created_at: string
  is_active: boolean
}

export interface Project {
  id: string
  title: string
  description: string | null
  subscriber_id: string
  main_contact_id: string | null
  status: ProjectStatus
  priority: Priority
  intake_payload: Record<string, unknown> | null
  created_at: string
  updated_at: string
  deployed_at: string | null
}

export interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  dod_criteria: string | null
  difficulty: Difficulty
  status: TaskStatus
  point_value: number
  max_developers: number
  approved_submission_id: string | null
  created_at: string
  updated_at: string
}

export interface TaskEnrollment {
  id: string
  task_id: string
  user_id: string
  enrolled_at: string
}

export interface Submission {
  id: string
  task_id: string
  builder_id: string
  github_url: string
  notes: string | null
  status: SubmissionStatus
  submitted_at: string
  updated_at: string
}

export interface Review {
  id: string
  submission_id: string
  task_id: string
  reviewer_id: string
  decision: 'approved' | 'rejected'
  feedback: string | null
  reviewed_at: string
}

export interface PointTransaction {
  id: string
  user_id: string
  project_id: string
  task_id: string | null
  submission_id: string | null
  review_id: string | null
  type: PointType
  amount: number
  status: PointStatus
  description: string | null
  created_at: string
}
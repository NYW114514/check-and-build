'use client'

import { useEffect, useState } from 'react'
import { useUser } from '../../lib/context/UserContext'
import { getPointsByUser } from '../../lib/services/points'
import { PointTransaction } from '../../lib/types'

export default function ProfilePage() {
  const { currentUser } = useUser()
  const [transactions, setTransactions] = useState<PointTransaction[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentUser) { setLoading(false); return }
    getPointsByUser(currentUser.id)
      .then(setTransactions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [currentUser])

  if (!currentUser) {
    return <div className="p-8 text-gray-500">Please select a user first.</div>
  }

  if (loading) {
    return <div className="p-8">Loading...</div>
  }

  const earned = transactions.filter(t => t.status === 'earned').reduce((sum, t) => sum + t.amount, 0)
  const pending = transactions.filter(t => t.status === 'pending').reduce((sum, t) => sum + t.amount, 0)

  const buildEarned = transactions.filter(t => t.type === 'build' && t.status === 'earned').reduce((sum, t) => sum + t.amount, 0)
  const buildPending = transactions.filter(t => t.type === 'build' && t.status === 'pending').reduce((sum, t) => sum + t.amount, 0)
  const reviewEarned = transactions.filter(t => t.type === 'review' && t.status === 'earned').reduce((sum, t) => sum + t.amount, 0)
  const reviewPending = transactions.filter(t => t.type === 'review' && t.status === 'pending').reduce((sum, t) => sum + t.amount, 0)
  const assembleEarned = transactions.filter(t => t.type === 'assemble' && t.status === 'earned').reduce((sum, t) => sum + t.amount, 0)
  const assemblePending = transactions.filter(t => t.type === 'assemble' && t.status === 'pending').reduce((sum, t) => sum + t.amount, 0)

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">{currentUser.name}</h1>
      <p className="text-gray-500 text-sm mb-6">{currentUser.role.toUpperCase()}</p>

      <div className="space-y-3 mb-8">
        {[
          { label: 'Build Points', earned: buildEarned, pending: buildPending, color: 'text-blue-600' },
          { label: 'Review Points', earned: reviewEarned, pending: reviewPending, color: 'text-purple-600' },
          { label: 'Assemble Points', earned: assembleEarned, pending: assemblePending, color: 'text-teal-600' },
        ].map(row => (
          <div key={row.label} className="border border-gray-200 rounded-lg px-5 py-3 bg-white flex items-center justify-between">
            <span className={`font-semibold text-sm ${row.color}`}>{row.label}</span>
            <div className="flex gap-6">
              <div className="text-center">
                <div className={`text-xl font-bold ${row.color}`}>{row.earned}</div>
                <div className="text-xs text-gray-400">Earned</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-amber-500">{row.pending}</div>
                <div className="text-xs text-gray-400">Pending</div>
              </div>
            </div>
          </div>
        ))}
        <div className="border border-gray-200 rounded-lg px-5 py-3 bg-gray-50 flex items-center justify-between">
          <span className="font-semibold text-sm text-gray-600">Total</span>
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-xl font-bold text-green-600">{earned}</div>
              <div className="text-xs text-gray-400">Earned</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-amber-500">{pending}</div>
              <div className="text-xs text-gray-400">Pending</div>
            </div>
          </div>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-4">Transaction History</h2>
      {transactions.length === 0 ? (
        <p className="text-gray-500">No transactions yet.</p>
      ) : (
        <div className="space-y-2">
          {transactions.map(t => (
            <div key={t.id} className="flex items-center justify-between border border-gray-100 rounded-lg px-4 py-3 bg-white">
              <div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded mr-2 ${
                  t.type === 'build' ? 'bg-blue-100 text-blue-700' :
                  t.type === 'review' ? 'bg-purple-100 text-purple-700' :
                  'bg-teal-100 text-teal-700'
                }`}>
                  {t.type.toUpperCase()}
                </span>
                <span className="text-sm text-gray-600">{t.description ?? '—'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded ${
                  t.status === 'earned' ? 'bg-green-100 text-green-700' :
                  t.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {t.status}
                </span>
                <span className="font-semibold text-gray-800">+{t.amount} pts</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
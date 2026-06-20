'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { User } from '../types'
import { getUsers } from '../services/users'

interface UserContextType {
  currentUser: User | null
  setCurrentUser: (user: User | null) => void
}

const UserContext = createContext<UserContextType>({
  currentUser: null,
  setCurrentUser: () => {},
})

export function UserProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUserState] = useState<User | null>(null)

  function setCurrentUser(user: User | null) {
    setCurrentUserState(user)
    if (user) {
      localStorage.setItem('currentUserId', user.id)
    } else {
      localStorage.removeItem('currentUserId')
    }
  }

  useEffect(() => {
    const savedId = localStorage.getItem('currentUserId')
    if (savedId) {
      getUsers().then(users => {
        const user = users.find(u => u.id === savedId) ?? null
        setCurrentUserState(user)
      })
    }
  }, [])

  return (
    <UserContext.Provider value={{ currentUser, setCurrentUser }}>
      {children}
    </UserContext.Provider>
  )
}
export function useUser() {
  return useContext(UserContext)
}
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/auth-context'
import { AuthGuard } from '@/components/auth/auth-guard'
import { AppLayout } from '@/components/layout/app-layout'
import { LoginForm } from '@/components/auth/login-form'

// Pages
import { Dashboard } from '@/pages/dashboard'
import { ItemsList } from '@/pages/items/index'
import { NewItem } from '@/pages/items/new'
import { EditItem } from '@/pages/items/edit'
import { ItemDetail } from '@/pages/items/detail'
import { BorrowApply } from '@/pages/borrow/apply'
import { MyRequests } from '@/pages/borrow/my-requests'
import { BorrowReturn } from '@/pages/borrow/return'
import { BorrowRenew } from '@/pages/borrow/renew'
import { ApprovalQueue } from '@/pages/approval/queue'
import { ApprovalDetail } from '@/pages/approval/detail'
import { UsersPage } from '@/pages/admin/users'
import { CategoriesPage } from '@/pages/admin/categories'
import { ApprovalChainsPage } from '@/pages/admin/approval-chains'
import { SettingsPage } from '@/pages/admin/settings'
import { ReportsPage } from '@/pages/reports/index'
import { PendingApproval } from '@/pages/pending-approval'
import { AccountDisabled } from '@/pages/account-disabled'
import { ResetPassword } from '@/pages/reset-password'

function App() {
  return (
    <BrowserRouter basename="/dji-demo-manager">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginForm />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/pending-approval" element={<PendingApproval />} />
          <Route path="/account-disabled" element={<AccountDisabled />} />

          <Route element={
            <AuthGuard>
              <AppLayout />
            </AuthGuard>
          }>
            <Route index element={<Dashboard />} />
            <Route path="items" element={<ItemsList />} />
            <Route path="items/new" element={
              <AuthGuard requireRole={['admin']}>
                <NewItem />
              </AuthGuard>
            } />
            <Route path="items/:id" element={<ItemDetail />} />
            <Route path="items/:id/edit" element={
              <AuthGuard requireRole={['admin']}>
                <EditItem />
              </AuthGuard>
            } />
            <Route path="borrow/apply" element={<BorrowApply />} />
            <Route path="borrow/apply/:itemId" element={<BorrowApply />} />
            <Route path="borrow/my-requests" element={<MyRequests />} />
            <Route path="borrow/return/:id" element={<BorrowReturn />} />
            <Route path="borrow/renew/:id" element={<BorrowRenew />} />
            <Route path="approval/queue" element={
              <AuthGuard requireRole={['super_admin', 'admin', 'approver']}>
                <ApprovalQueue />
              </AuthGuard>
            } />
            <Route path="approval/:id" element={<ApprovalDetail />} />
            <Route path="admin/users" element={
              <AuthGuard requireRole={['super_admin']}>
                <UsersPage />
              </AuthGuard>
            } />
            <Route path="admin/categories" element={
              <AuthGuard requireRole={['super_admin', 'admin']}>
                <CategoriesPage />
              </AuthGuard>
            } />
            <Route path="admin/approval-chains" element={
              <AuthGuard requireRole={['super_admin', 'admin']}>
                <ApprovalChainsPage />
              </AuthGuard>
            } />
            <Route path="admin/settings" element={
              <AuthGuard requireRole={['super_admin']}>
                <SettingsPage />
              </AuthGuard>
            } />
            <Route path="reports" element={<ReportsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

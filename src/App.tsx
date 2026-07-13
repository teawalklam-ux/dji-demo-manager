import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/contexts/auth-context'
import { AuthGuard } from '@/components/auth/auth-guard'
import { AppLayout } from '@/components/layout/app-layout'
import { LoginForm } from '@/components/auth/login-form'

const Dashboard = lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.Dashboard })))
const ItemsList = lazy(() => import('@/pages/items/index').then((m) => ({ default: m.ItemsList })))
const NewItem = lazy(() => import('@/pages/items/new').then((m) => ({ default: m.NewItem })))
const EditItem = lazy(() => import('@/pages/items/edit').then((m) => ({ default: m.EditItem })))
const ItemDetail = lazy(() => import('@/pages/items/detail').then((m) => ({ default: m.ItemDetail })))
const BorrowApply = lazy(() => import('@/pages/borrow/apply').then((m) => ({ default: m.BorrowApply })))
const MyRequests = lazy(() => import('@/pages/borrow/my-requests').then((m) => ({ default: m.MyRequests })))
const BorrowReturn = lazy(() => import('@/pages/borrow/return').then((m) => ({ default: m.BorrowReturn })))
const BorrowRenew = lazy(() => import('@/pages/borrow/renew').then((m) => ({ default: m.BorrowRenew })))
const ApprovalQueue = lazy(() => import('@/pages/approval/queue').then((m) => ({ default: m.ApprovalQueue })))
const ApprovalDetail = lazy(() => import('@/pages/approval/detail').then((m) => ({ default: m.ApprovalDetail })))
const UsersPage = lazy(() => import('@/pages/admin/users').then((m) => ({ default: m.UsersPage })))
const CategoriesPage = lazy(() => import('@/pages/admin/categories').then((m) => ({ default: m.CategoriesPage })))
const ApprovalChainsPage = lazy(() => import('@/pages/admin/approval-chains').then((m) => ({ default: m.ApprovalChainsPage })))
const SettingsPage = lazy(() => import('@/pages/admin/settings').then((m) => ({ default: m.SettingsPage })))
const CustomersPage = lazy(() => import('@/pages/admin/customers').then((m) => ({ default: m.CustomersPage })))
const ReportsPage = lazy(() => import('@/pages/reports/index').then((m) => ({ default: m.ReportsPage })))
const PendingApproval = lazy(() => import('@/pages/pending-approval').then((m) => ({ default: m.PendingApproval })))
const AccountDisabled = lazy(() => import('@/pages/account-disabled').then((m) => ({ default: m.AccountDisabled })))
const ResetPassword = lazy(() => import('@/pages/reset-password').then((m) => ({ default: m.ResetPassword })))

function App() {
  return (
    <BrowserRouter basename="/dji-demo-manager">
      <AuthProvider>
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">加载中...</div>}>
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
            <Route path="admin/customers" element={
              <AuthGuard requireRole={['super_admin']}>
                <CustomersPage />
              </AuthGuard>
            } />
            <Route path="reports" element={<ReportsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App

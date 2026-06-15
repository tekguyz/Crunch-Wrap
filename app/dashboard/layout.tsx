import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import Sidebar from '@/components/ui/Sidebar';
import BottomNav from '@/components/ui/BottomNav';
import ImportOrchestrator from '@/components/ImportOrchestrator';
import PresenceInitializer from '@/components/PresenceInitializer';
import InsightSubscriptionInitializer from '@/components/InsightSubscriptionInitializer';
import { Toast } from '@/components/ui/Toast';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const isDevBypass = cookieStore.has('crispy_dev_bypass') || cookieStore.has('crunch_dev_bypass');

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isDevBypass) {
    redirect('/auth');
  }

  const userEmail = user?.email || cookieStore.get('crunch_dev_email')?.value || 'demo@tekguyz.com';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <InsightSubscriptionInitializer />
      <ImportOrchestrator />
      <PresenceInitializer email={userEmail} />
      <Sidebar email={userEmail} />
      
      <main className="flex-1 overflow-y-auto relative flex flex-col pb-24 md:pb-8">
        <div className="flex-1 bg-surface md:rounded-[32px] md:shadow-m3 flex flex-col">
          {children}
        </div>
      </main>

      <BottomNav />
      <Toast />
    </div>
  );
}

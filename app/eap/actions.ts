'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

// Submits a redress request for one Course Workshop subject. Capped to
// Absent rows only — both by the UI (button only renders for status==='A')
// and by the RLS policy itself (update only allowed where status = 'A'),
// so this can't be used to touch Present/NA/Late rows even if someone
// called it directly.
export async function requestCourseWorkshopRedress(subjectName: string, reason: string) {
  if (!reason.trim()) {
    return { error: 'A reason is required.' };
  }

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'Not signed in.' };
  }

  const { data: student } = await supabase
    .from('students')
    .select('reg_no')
    .eq('auth_user_id', user.id)
    .single();
  if (!student) {
    return { error: 'Student record not found.' };
  }

  const { error } = await supabase
    .from('eap_course_workshop_attendance')
    .update({
      redress_requested: true,
      redress_reason: reason.trim(),
      redress_submitted_at: new Date().toISOString(),
    })
    .eq('reg_no', student.reg_no)
    .eq('subject_name', subjectName)
    .eq('status', 'A');

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/eap');
  return { success: true };
}

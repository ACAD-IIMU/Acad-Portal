'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { uploadEapRedressProof } from '@/lib/googleDrive';

// Vercel serverless functions cap the request body around 4.5MB. Redress
// proof is a screenshot/single document, not a large file, so the simple
// direct-buffer Drive upload (not the resumable flow prereads uses for big
// timetable files) is the right fit here — just needs a size guard.
const MAX_PROOF_BYTES = 4 * 1024 * 1024;

// Takes FormData, not separate arguments — a raw File object can't be passed
// as a plain Server Action argument (Next.js rejects it: "File objects are
// not supported"), only inside FormData.
export async function requestCourseWorkshopRedress(formData: FormData) {
  const subjectName = formData.get('subjectName');
  const reason = formData.get('reason');
  const proofFile = formData.get('proof') as File | null;

  if (typeof subjectName !== 'string' || !subjectName) {
    return { error: 'Missing subject.' };
  }
  if (typeof reason !== 'string' || !reason.trim()) {
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

  let proofDriveId: string | null = null;
  let proofFileName: string | null = null;

  // Proof is optional — matches Requirements §4.4 ("not mandatory to be a
  // file"). Only upload if one was actually attached.
  if (proofFile && proofFile.size > 0) {
    if (proofFile.size > MAX_PROOF_BYTES) {
      return { error: 'File is too large — please keep it under 4MB.' };
    }
    const ext = proofFile.name.includes('.') ? proofFile.name.slice(proofFile.name.lastIndexOf('.')) : '';
    // Naming convention: rollno_courseworkshopname
    const driveFileName = `${student.reg_no}_${subjectName}${ext}`;
    const buffer = Buffer.from(await proofFile.arrayBuffer());
    const uploaded = await uploadEapRedressProof(
      driveFileName,
      proofFile.type || 'application/octet-stream',
      buffer
    );
    proofDriveId = uploaded.fileId;
    proofFileName = uploaded.fileName;
  }

  const { error } = await supabase
    .from('eap_course_workshop_attendance')
    .update({
      redress_requested: true,
      redress_reason: reason.trim(),
      redress_submitted_at: new Date().toISOString(),
      redress_proof_drive_id: proofDriveId,
      redress_proof_file_name: proofFileName,
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

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { saveInsight } from '@/lib/storage/localDbService';
import type { Insight } from '@/lib/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useUIStore } from '@/lib/store';
import { unstable_batchedUpdates } from 'react-dom';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const router = useRouter();
  const queryClient = useQueryClient();
  const supabase = createClient();
  const { showToast } = useUIStore();

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const cleanup = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  }, []);

  const startRecordingWithStream = useCallback(async (stream: MediaStream) => {
    audioChunksRef.current = [];
    setRecordingTime(0);

    mediaStreamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm')
      ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

    const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data);
      }
    };

    mediaRecorder.start();
    setIsRecording(true);

    timerIntervalRef.current = setInterval(() => {
      setRecordingTime((prev) => prev + 1);
    }, 1000);
  }, []);

  const startMicRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      await startRecordingWithStream(stream);
    } catch (error) {
      console.error('Failed to start mic recording:', error);
      cleanup();
    }
  }, [cleanup, startRecordingWithStream]);

  const startScreenAudioRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      const audioTrack = stream.getAudioTracks()[0];
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.stop(); // Nuke the video, keep the audio
      const audioOnlyStream = new MediaStream([audioTrack]);

      await startRecordingWithStream(audioOnlyStream);
    } catch (error) {
      console.error('Failed to start screen audio recording:', error);
      cleanup();
    }
  }, [cleanup, startRecordingWithStream]);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    if (!mediaRecorderRef.current) return;

    return new Promise<void>((resolve) => {
      mediaRecorderRef.current!.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current!.mimeType });
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        
        const extension = blob.type.includes('webm') ? '.webm' : blob.type.includes('mp4') ? '.m4a' : '.ogg';
        const fileName = `voice-note-${now}${extension}`;

        const newInsight: Insight = {
          id,
          title: `Voice Note - ${new Date().toLocaleString()}`,
          raw_content: blob,
          processing_status: 'uploading',
          created_at: now,
          updated_at: now,
        };

        try {
          await saveInsight(newInsight);
          
          unstable_batchedUpdates(() => {
            queryClient.setQueryData(['localInsight', id], newInsight);
            queryClient.setQueryData(['insight', id], newInsight);
            queryClient.setQueriesData({ queryKey: ['insights'] }, (oldList: any[] | undefined) => {
              if (!oldList) return [newInsight];
              return [newInsight, ...oldList];
            });
            queryClient.setQueriesData({ queryKey: ['localInsights'] }, (oldList: any[] | undefined) => {
              if (!oldList) return [newInsight];
              return [newInsight, ...oldList];
            });
          });

          console.log('Successfully saved voice note locally:', id);
          router.push(`/dashboard/files/${id}`);

          // --- FOREGROUND PIPELINE ---
          (async () => {
            try {
              const isDemo = document.cookie.includes('crunch_dev_bypass=true') || document.cookie.includes('crispy_dev_bypass=true');
              const { data: { user } } = await supabase.auth.getUser();
              if (!user && !isDemo) throw new Error('No user session available');

              const mimeType = blob.type;
              const filePath = user ? `${user.id}/${Date.now()}-${id}${extension}` : `demo/${Date.now()}-${id}${extension}`;

              if (user) {
                // Get Signed Upload URL
                const { data: signedData, error: signedError } = await supabase.storage
                  .from('meetings')
                  .createSignedUploadUrl(filePath);
                
                if (signedError) throw signedError;

                // Upload using raw PUT request
                if (blob.size < 1000) throw new Error("Blob is corrupted or empty before upload");

                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DATABASE_URL;
                const finalUrl = new URL(signedData.signedUrl, supabaseUrl!).toString();

                const uploadResponse = await fetch(finalUrl, {
                  method: 'PUT',
                  body: blob,
                  headers: { 'Content-Type': mimeType }
                });

                if (!uploadResponse.ok) throw new Error('Failed to upload file');
              }

              if (user) {
                // Insert into Supabase DB
                const { data: dbInsight, error: dbError } = await supabase
                  .from('insights')
                  .upsert({
                    id: id,
                    user_id: user.id,
                    title: newInsight.title,
                    processing_status: 'analyzing',
                    audio_url: filePath,
                    summary: 'Analyzing...',
                  }, { onConflict: 'id' })
                  .select()
                  .single();

                if (dbError) throw dbError;
              }

              // Mark as analyzing locally
              const analyzingInsight = {
                ...newInsight,
                processing_status: 'analyzing' as const,
                updated_at: new Date().toISOString(),
              };
              await saveInsight(analyzingInsight);
              
              // Update cache for analyzing state
              unstable_batchedUpdates(() => {
                queryClient.setQueryData(['localInsight', id], analyzingInsight);
                queryClient.setQueryData(['insight', id], analyzingInsight);
                queryClient.setQueriesData({ queryKey: ['insights'] }, (oldList: any[] | undefined) => {
                  if (!oldList) return oldList;
                  return oldList.map(item => item.id === id ? { ...item, processing_status: 'analyzing' } : item);
                });
                queryClient.setQueriesData({ queryKey: ['localInsights'] }, (oldList: any[] | undefined) => {
                  if (!oldList) return oldList;
                  return oldList.map(item => item.id === id ? { ...item, processing_status: 'analyzing' } : item);
                });
              });

              // Call API
              const apiBody: any = { 
                insightId: id,
                mimeType: mimeType,
                isDeepAnalysisEnabled: false,
                audioUrl: filePath,
                isDemoMode: isDemo
              };

              const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(apiBody),
              });

              if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Analysis failed');
              }

              const responseData = await response.json();
              console.log("API Payload:", responseData);
              const { intelligence, dbInsight: returnedDbInsight } = responseData;

              unstable_batchedUpdates(() => {
                // Update Cache
                const updatedData = {
                  ...returnedDbInsight,
                  processing_status: 'completed',
                  title: intelligence?.title,
                  intelligence: intelligence
                };

                queryClient.setQueryData(['insight', id], (oldData: any) => ({ ...oldData, ...updatedData }));
                queryClient.setQueryData(['localInsight', id], (oldData: any) => ({ ...oldData, ...updatedData }));
                queryClient.setQueryData(['supabaseInsight', id], (oldData: any) => ({ ...oldData, ...updatedData }));

                queryClient.setQueriesData({ queryKey: ['insights'] }, (oldList: any[] | undefined) => {
                  if (!oldList) return oldList;
                  return oldList.map(item => item.id === id ? { ...item, ...updatedData } : item);
                });
                
                queryClient.setQueriesData({ queryKey: ['localInsights'] }, (oldList: any[] | undefined) => {
                  if (!oldList) return oldList;
                  return oldList.map(item => item.id === id ? { ...item, ...updatedData } : item);
                });
              });

              // Mark as completed in local DB
              await saveInsight({
                ...newInsight,
                ...returnedDbInsight,
                processing_status: 'completed',
                intelligence: intelligence,
                title: intelligence?.title,
                updated_at: new Date().toISOString(),
              });

            } catch (error) {
              console.error(`Foreground processing failed for voice note ${id}:`, error);
              // Fallback to local status so the background worker can pick it up if needed
            }
          })();

        } catch (error) {
          console.error('Failed to save voice note:', error);
          showToast('Failed to save voice note', 'error');
        }

        cleanup();
        audioChunksRef.current = [];
        setRecordingTime(0);
        resolve();
      };

      mediaRecorderRef.current?.stop();
    });
  }, [cleanup, router, queryClient, supabase, showToast]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isRecording,
    recordingTime,
    startMicRecording,
    startScreenAudioRecording,
    stopRecording,
  };
}

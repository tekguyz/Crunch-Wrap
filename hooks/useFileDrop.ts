import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { saveInsight } from '@/lib/storage/localDbService';
import { parseFile } from '@/lib/utils/fileParser';
import { useUIStore } from '@/lib/store';
import type { Insight } from '@/lib/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { unstable_batchedUpdates } from 'react-dom';

export function useFileDrop() {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const router = useRouter();
  const { showToast } = useUIStore();
  const queryClient = useQueryClient();
  const supabase = createClient();

  const onDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    for (const file of fileArray) {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        showToast('PDFs are not supported in this lightweight version.', 'error');
        continue;
      }

      try {
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        
        let rawContent: string | Blob;
        
        if (file.type.startsWith('audio/')) {
          rawContent = file; // Save the raw File object directly
        } else {
          rawContent = await parseFile(file) as string;
        }
        
        const newInsight: Insight = {
          id,
          title: file.name,
          raw_content: rawContent,
          processing_status: 'uploading',
          created_at: now,
          updated_at: now,
        };

        await saveInsight(newInsight);
        
        unstable_batchedUpdates(() => {
          // Update cache for optimistic UI
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

        console.log('Successfully saved insight locally:', newInsight.id);
        
        // Optimistic routing: navigate immediately
        router.push(`/dashboard/files/${newInsight.id}`);
        
        // --- FOREGROUND PIPELINE ---
        (async () => {
          try {
            const isDemo = document.cookie.includes('crunch_dev_bypass=true') || document.cookie.includes('crispy_dev_bypass=true');
            const { data: { user } } = await supabase.auth.getUser();
            if (!user && !isDemo) throw new Error('No user session available');

            const isDocument = typeof rawContent === 'string';
            let fileName = '';
            let contentType = '';
            let mimeType = '';
            let filePath = '';

            if (isDocument) {
              fileName = `${Date.now()}-${id}.md`;
              contentType = 'text/markdown';
              mimeType = 'text/markdown';
              filePath = user ? `${user.id}/${fileName}` : `demo/${fileName}`;
            } else {
              const blob = rawContent as Blob;
              mimeType = blob.type || 'audio/webm';
              const ext = mimeType.includes('mpeg') || mimeType.includes('mp3') ? 'mp3' : 'webm';
              fileName = `${Date.now()}-${id}.${ext}`;
              contentType = mimeType;
              filePath = user ? `${user.id}/${fileName}` : `demo/${fileName}`;

              if (user) {
                // Get Signed Upload URL
                const { data: signedData, error: signedError } = await supabase.storage
                  .from('meetings')
                  .createSignedUploadUrl(filePath);
                
                if (signedError) throw signedError;

                // Upload using raw PUT request
                const uploadBlob = rawContent as Blob;
                if (uploadBlob.size < 1000) throw new Error("Blob is corrupted or empty before upload");

                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_DATABASE_URL;
                const finalUrl = new URL(signedData.signedUrl, supabaseUrl!).toString();

                const uploadResponse = await fetch(finalUrl, {
                  method: 'PUT',
                  body: uploadBlob,
                  headers: { 'Content-Type': contentType }
                });

                if (!uploadResponse.ok) throw new Error('Failed to upload file');
              }
            }

            if (user) {
              // Insert into Supabase DB
              const { data: dbInsight, error: dbError } = await supabase
                .from('insights')
                .upsert({
                  id: id,
                  user_id: user.id,
                  title: file.name,
                  processing_status: 'analyzing',
                  audio_url: isDocument ? null : filePath,
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
              isDemoMode: isDemo
            };
            if (isDocument) {
              apiBody.textPayload = rawContent;
            } else {
              apiBody.audioUrl = filePath;
            }

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
            console.error(`Foreground processing failed for ${id}:`, error);
            // Fallback to local status so the background worker can pick it up if needed
            // Or mark as failed if it's a hard error
            // We leave it as 'uploading' or 'analyzing' and let the background worker retry if it's stuck
          }
        })();
        
      } catch (error) {
        console.error('Error processing dropped file:', error);
        showToast(`Failed to import ${file.name}`, 'error');
      }
    }
    
    showToast('Importing documents...', 'info');
  }, [router, showToast, queryClient, supabase]);

  const onDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const handleFileInput = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
      // Reset input so the same file can be selected again
      e.target.value = '';
    }
  }, [processFiles]);

  return {
    isDragging,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    handleFileInput,
  };
}

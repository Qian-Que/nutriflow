import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { readCache } from './offlineStore';
import { JOBS_CACHE, UPLOAD_CACHE, abandonUpload, mergeJobList, prepareUpload, recoverUpload, uploadRecognition, type BackgroundJob, type JobContext, type RecognitionTransport, type UploadTicket } from './backgroundRecognition';

export function useRecognitionInbox(transport: RecognitionTransport, token: string) {
  const [jobs,setJobs] = useState<BackgroundJob[]>([]), [ticket,setTicket] = useState<UploadTicket | null>(null);
  const [message,setMessage] = useState(''), [busy,setBusy] = useState(false);
  const [acceptedUpload,setAcceptedUpload] = useState<UploadTicket | null>(null);
  const active = useRef(true), fetching = useRef(false), submitting = useRef(false), nextRecovery = useRef(0);
  const generation = useRef(0);
  const needsPoll = useRef(false);
  needsPoll.current = jobs.some(job => ['queued','running'].includes(job.status)) || Boolean(ticket);
  const refresh = useCallback(async (recover = false) => {
    if (fetching.current || submitting.current || AppState.currentState !== 'active') return;
    fetching.current = true;
    const version = generation.current;
    try {
      const response = await transport<{jobs:BackgroundJob[]}>('/api/recognition/jobs?includeSaved=1',{},token,{timeoutMs:8000});
      if (submitting.current || generation.current !== version) return;
      let list = await mergeJobList(token,response.jobs);
      if (recover && !submitting.current) {
        const allowPost = Date.now() >= nextRecovery.current;
        if (allowPost) nextRecovery.current = Date.now() + 30000;
        try {
          const restored = await recoverUpload(transport,token,list,allowPost);
          if (restored) {
            list = await readCache<BackgroundJob[]>(token,JOBS_CACHE) ?? list;
            if (active.current && restored.clearedDraft) setAcceptedUpload(restored.ticket);
          }
        } catch { if (active.current) setMessage('上传结果尚未确认，内容已保存在本机；可重试上传'); }
      }
      if (!active.current || submitting.current || generation.current !== version) return;
      for (const job of list) {
        if (job.timings.uploadMs !== null && response.jobs.find(row=>row.id===job.id)?.timings.uploadMs === null) {
          void transport(`/api/recognition/jobs/${job.id}/timing`,{method:'PATCH',body:JSON.stringify({uploadMs:job.timings.uploadMs})},token,{timeoutMs:4000}).catch(()=>{});
        }
      }
      setJobs(list); setTicket(await readCache<UploadTicket>(token,UPLOAD_CACHE));
      if (!await readCache(token,UPLOAD_CACHE)) setMessage('');
    } catch { if (active.current) setMessage('暂时无法刷新任务，已显示本机缓存'); }
    finally { fetching.current = false; }
  }, [transport,token]);
  useEffect(() => {
    active.current = true;
    void (async () => {
      try {
        const [cached,upload] = await Promise.all([readCache<BackgroundJob[]>(token,JOBS_CACHE),readCache<UploadTicket>(token,UPLOAD_CACHE)]);
        if (active.current) { setJobs(cached ?? []); setTicket(upload); }
      } catch { if (active.current) setMessage('本地任务缓存读取失败'); }
      if (active.current) void refresh(true);
    })();
    const interval = setInterval(() => { if (needsPoll.current) void refresh(true); },4000);
    const subscription = AppState.addEventListener('change',state => { if (state === 'active') void refresh(true); });
    return () => { active.current = false; clearInterval(interval); subscription.remove(); };
  },[refresh,token]);
  const submit = async (input: UploadTicket['input'], context: JobContext) => {
    if (submitting.current) return;
    submitting.current = true; generation.current++; setBusy(true);
    try {
      const upload = await prepareUpload(token,input,context); setTicket(upload);
      const result = await uploadRecognition(transport,token,upload);
      if (active.current) {
        generation.current++;
        if (result.clearedDraft) setAcceptedUpload(result.ticket);
        setTicket(null); setMessage(result.job.reviewState==='dismissed'?'上传已取消，原内容保留':result.job.reviewState==='saved'?'识别完成，已保存':'已上传，正在后台识别');
        setJobs(await readCache<BackgroundJob[]>(token,JOBS_CACHE) ?? []);
      }
      return result;
    } catch (error) {
      setMessage('上传结果尚未确认，原内容已保留，请在任务列表重试');
      throw error;
    } finally { submitting.current = false; if (active.current) setBusy(false); }
  };
  const retryUpload = async () => {
    if (submitting.current) return;
    const upload = await readCache<UploadTicket>(token,UPLOAD_CACHE);
    if (upload) await submit(upload.input,upload.context);
  };
  const cancelUpload = async () => {
    if (submitting.current) return;
    submitting.current=true;generation.current++;setBusy(true);
    try { await abandonUpload(transport,token);setTicket(null);setMessage('上传已取消，原内容仍在输入框'); }
    finally { submitting.current=false;setBusy(false);void refresh(); }
  };
  return { jobs,ticket,busy,message,acceptedUpload,submit,retryUpload,cancelUpload,refresh };
}

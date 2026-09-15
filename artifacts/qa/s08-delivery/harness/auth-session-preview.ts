import { previewUser } from './auth-preview';
export async function authFetch(path:string,init:RequestInit={}) {
 if(!path.startsWith('/api/')||path.startsWith('//'))throw new Error('禁止非隔离 API');
 const headers=new Headers(init.headers);headers.delete('Authorization');headers.set('X-QA-User',previewUser().id);headers.set('X-Inogi-Fixture','S08-memory-only');
 if(typeof init.body==='string')headers.set('Content-Type','application/json');
 return fetch(path,{...init,headers,credentials:'omit'});
}
export const apiFetch=authFetch;
export async function readErrorMessage(response:Response,fallback:string){const data=await response.json().catch(()=>null);return typeof data?.message==='string'?data.message:fallback;}
export function getStoredUser(){return previewUser();}
export function addAuthClearedListener(){return ()=>{};}
export function getAccessToken(){return '';}
export function getRefreshToken(){return '';}
export function clearAuthSession(){}

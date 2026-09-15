import { type ReactNode } from 'react';
import { user } from './workspace-fixtures.mjs';
export function previewUser(){const mode=new URLSearchParams(location.search).get('access')||'manager'; const permissions=[...user.permissions,'page:audit-log',...(mode==='manager'?['proc-task:reassign']:mode==='rd'?['rd-task:reassign']:[])].filter(p=>!(mode==='noaudit'&&p==='page:audit-log')&&!(mode==='noplan'&&p==='page:proc-cockpit'));return {...user,permissions};}
export function AuthProvider({children}:{children:ReactNode}){return children;}
export function useAuth(){return {user:previewUser(),hydrated:true,login:async()=>({ok:false}),logout:async()=>{},refreshUser:async()=>previewUser()};}
export function getAccessToken(){return '';}
export function getRoleLabel(){return '隔离验证采购员';}

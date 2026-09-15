import React, { createContext, useContext, useState, type ReactNode } from 'react';
const roles = {
  manager: { id:'qa-manager', name:'隔离采购主管', permissions:['page:proc-my-workspace','page:purchase-orders','page:purchase-order-detail','proc-purchase-order:record-commitment','page:proc-cockpit','proc-operations:assign'] },
  reader: { id:'qa-reader', name:'隔离只读采购', permissions:['page:proc-my-workspace','page:purchase-orders','page:purchase-order-detail'] },
  warehouse: { id:'qa-warehouse', name:'隔离仓管人员', permissions:['page:purchase-order-detail'] },
  none: { id:'qa-no-order', name:'无订单权限账号', permissions:['page:proc-my-workspace'] },
};
let current = roles.manager;
const Context=createContext<any>({user:current});
export function AuthProvider({children}:{children:ReactNode}) {const [role,setRole]=useState<keyof typeof roles>('manager');current=roles[role];return <Context.Provider value={{user:current,role,setRole,hydrated:true}}>{children}</Context.Provider>;}
export function useAuth(){return useContext(Context);}
export function previewUser(){return current;}
export function getAccessToken(){return '';}
export function getRoleLabel(){return '隔离验证账号';}

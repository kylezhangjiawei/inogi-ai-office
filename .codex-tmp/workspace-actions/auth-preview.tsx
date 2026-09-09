import {previewUser} from '../../scripts/ui-preview/fixtures';
export const testUser={...previewUser,name:'采购验收员',permissions:new URLSearchParams(location.search).get('permission')==='none'?[]:['*']};
export function AuthProvider({children}:any){return children;}
export function useAuth(){return {user:testUser,hydrated:true};}
export function getAccessToken(){return '';}
export function getRoleLabel(){return '本地验收';}

import { GoneException } from '@nestjs/common';
export function retiredInventoryWrite(): never {
  throw new GoneException('该库存写入入口已停用，请到仓库工作台按原单办理');
}

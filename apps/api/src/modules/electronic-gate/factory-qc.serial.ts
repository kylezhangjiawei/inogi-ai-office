import { validateSerialConfig, type FactorySerialConfig } from './factory-qc.contract';
import type { GateConfig } from './electronic-gate.catalog';

export const FACTORY_SERIAL_ITEM_IDS = ['serial-port', 'baud-rate', 'response-timeout', 'retry-delay', 'data-bits', 'serial-parity', 'stop-bits', 'auto-connect', 'serial-handshake', 'serial-dtr', 'serial-rts', 'scan-interval'] as const;

/** Only explicit published items are projected; missing items never inherit defaults. */
export function serialFromItems(items: Record<string, GateConfig>, version: string): FactorySerialConfig | null {
  if (FACTORY_SERIAL_ITEM_IDS.some(id => items[id]?.enabled !== true)) return null;
  const values = (id: string) => items[id].values;
  const boolean = (id: string, key: string) => {
    const value = values(id)[key];
    if (value !== 'true' && value !== 'false') throw new Error(`${id} 缺少已发布的布尔配置`);
    return value === 'true';
  };
  const mode = values('serial-port').mode;
  if (mode !== 'auto' && mode !== 'fixed') throw new Error('串口选择方式无效');
  const retryText = values('retry-delay').retrySeconds;
  if (!/^\d+(?:\.\d{1,3})?$/.test(retryText) || Number(retryText) < 1 || Number(retryText) > 300) throw new Error('重试间隔须为 1 至 300 秒，最多三位小数');
  const parity = ({ none: 'None', odd: 'Odd', even: 'Even', mark: 'Mark', space: 'Space' } as Record<string, string>)[values('serial-parity').parity];
  const stopBits = ({ '1': 'One', '2': 'Two', '1.5': 'OnePointFive' } as Record<string, string>)[values('stop-bits').stopBits];
  return validateSerialConfig({
    schemaVersion: 1, version,
    autoConnect: boolean('auto-connect', 'autoConnect'),
    portName: mode === 'fixed' ? values('serial-port').port?.trim() : 'auto',
    baudRate: Number(values('baud-rate').baudRate), dataBits: Number(values('data-bits').dataBits),
    parity, stopBits, handshake: values('serial-handshake').handshake,
    dtrEnable: boolean('serial-dtr', 'dtrEnable'), rtsEnable: boolean('serial-rts', 'rtsEnable'),
    queryTimeoutMs: Number(values('response-timeout').timeoutMs),
    scanIntervalMs: Number(values('scan-interval').scanIntervalMs), retryDelayMs: Math.round(Number(retryText) * 1000),
  });
}

/** Reverse only complete snapshots, without inventing values absent from imported JSON. */
export function serialToItemValues(input: FactorySerialConfig): Record<string, Record<string, string>> {
  const config = validateSerialConfig(input);
  const required = ['autoConnect', 'portName', 'baudRate', 'dataBits', 'parity', 'stopBits', 'handshake', 'dtrEnable', 'rtsEnable', 'queryTimeoutMs', 'scanIntervalMs', 'retryDelayMs'] as const;
  for (const key of required) if (config[key] === undefined) throw new Error(`串口快照缺少 ${key}，不能还原独立配置项`);
  const auto = config.portName!.toLowerCase() === 'auto';
  const stopBits = ({ one: '1', two: '2', onepointfive: '1.5' } as Record<string, string>)[config.stopBits!.toLowerCase()];
  const handshake = ({ none: 'None', xonxoff: 'XOnXOff', requesttosend: 'RequestToSend', requesttosendxonxoff: 'RequestToSendXOnXOff' } as Record<string, string>)[config.handshake!.toLowerCase()];
  return {
    'serial-port': { mode: auto ? 'auto' : 'fixed', port: auto ? '' : config.portName! },
    'baud-rate': { baudRate: String(config.baudRate) }, 'data-bits': { dataBits: String(config.dataBits) },
    'serial-parity': { parity: config.parity!.toLowerCase() }, 'stop-bits': { stopBits },
    'response-timeout': { timeoutMs: String(config.queryTimeoutMs) }, 'retry-delay': { retrySeconds: String(config.retryDelayMs! / 1000) },
    'auto-connect': { autoConnect: String(config.autoConnect) }, 'serial-handshake': { handshake },
    'serial-dtr': { dtrEnable: String(config.dtrEnable) }, 'serial-rts': { rtsEnable: String(config.rtsEnable) },
    'scan-interval': { scanIntervalMs: String(config.scanIntervalMs) },
  };
}

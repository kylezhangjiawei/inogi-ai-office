import type { FactoryProtocolCatalog, FactorySerialConfig } from './factory-qc.contract';

/** Confirmed 0910 desktop defaults; existing database drafts and published snapshots are preserved. */
export const FACTORY_PROTOCOL_DEFAULT: FactoryProtocolCatalog = {
  "schemaVersion": 1,
  "minAppVersion": "0.5.8",
  "version": "builtin-20260910-v3",
  "profiles": [
    {
      "id": "legacy-v1",
      "name": "旧版三字节固件协议",
      "commands": [
        {
          "id": "firmware",
          "name": "固件版本",
          "operation": "read",
          "enabled": true,
          "queryCode": "72",
          "responseCode": "72",
          "payloadLength": 3,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 3,
              "type": "hex",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "V"
            }
          ],
          "samples": [
            {
              "frameHex": "F5 07 F8 72 01 02 03",
              "expected": {
                "value": "V010203"
              }
            }
          ]
        },
        {
          "id": "valve",
          "name": "阀类型",
          "operation": "read",
          "enabled": true,
          "queryCode": "74",
          "responseCode": "74",
          "payloadLength": 1,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "MAC 阀",
                "1": "方阀"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 74 01",
              "expected": {
                "value": "方阀"
              }
            }
          ]
        },
        {
          "id": "debug",
          "name": "Debug 状态",
          "operation": "read",
          "enabled": true,
          "queryCode": "75",
          "responseCode": "75",
          "payloadLength": 1,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "0",
                "1": "1"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 75 01",
              "expected": {
                "value": "1"
              }
            }
          ]
        },
        {
          "id": "usage",
          "name": "累计使用时间",
          "operation": "read",
          "enabled": true,
          "queryCode": "76",
          "responseCode": "76",
          "payloadLength": 4,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 4,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "秒",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 08 F7 76 00 01 E2 40",
              "expected": {
                "value": "123456"
              }
            }
          ]
        },
        {
          "id": "fpga",
          "name": "FPGA 版本",
          "operation": "read",
          "enabled": true,
          "queryCode": "82",
          "responseCode": "82",
          "payloadLength": 1,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 82 29",
              "expected": {
                "value": "41"
              }
            }
          ]
        },
        {
          "id": "calibration232",
          "name": "232 状态",
          "operation": "read",
          "enabled": true,
          "queryCode": "84",
          "responseCode": "84",
          "payloadLength": 1,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "0",
                "1": "1"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 84 01",
              "expected": {
                "value": "1"
              }
            }
          ]
        },
        {
          "id": "pressure",
          "name": "当前大气压",
          "operation": "read",
          "enabled": true,
          "queryCode": "85",
          "responseCode": "85",
          "payloadLength": 1,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "kPa",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 85 65",
              "expected": {
                "value": "101"
              }
            }
          ]
        }
      ]
    },
    {
      "id": "v4-20260910",
      "name": "2026-09-10 整理版协议（须手动选择并确认新版固件）",
      "firmwarePrefix": "V4.0UA81",
      "commands": [
        {
          "id": "firmware",
          "name": "固件完整版本（BCD 子版本）",
          "operation": "read",
          "enabled": true,
          "queryCode": "72",
          "responseCode": "72",
          "payloadLength": 9,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "main",
              "name": "主版本",
              "offset": 0,
              "length": 8,
              "type": "ascii",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            },
            {
              "id": "sub",
              "name": "BCD 子版本",
              "offset": 8,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "16": "10"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 0D F2 72 56342E3055413831 10",
              "expected": {
                "main": "V4.0UA81",
                "sub": "10"
              }
            }
          ]
        },
        {
          "id": "model",
          "name": "机器型号",
          "operation": "read",
          "enabled": true,
          "queryCode": "70",
          "responseCode": "70",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "Q4",
                "1": "Q5",
                "2": "Q6",
                "3": "Q7",
                "255": "无法识别"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 70 00",
              "expected": {
                "value": "Q4"
              }
            }
          ]
        },
        {
          "id": "market",
          "name": "发货市场",
          "operation": "read",
          "enabled": true,
          "queryCode": "71",
          "responseCode": "71",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "美国",
                "1": "中国",
                "2": "智利",
                "3": "乌拉圭",
                "4": "台湾",
                "255": "无法识别"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 71 00",
              "expected": {
                "value": "美国"
              }
            }
          ]
        },
        {
          "id": "parameters",
          "name": "当前实际生效参数（八组）",
          "operation": "read",
          "enabled": true,
          "queryCode": "73",
          "responseCode": "73",
          "payloadLength": 40,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "slot0Gear",
              "name": "参数组 1 档位",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot0Speed",
              "name": "参数组 1 设定转速",
              "offset": 1,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot0Duration",
              "name": "参数组 1 R210A 时长",
              "offset": 3,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            },
            {
              "id": "slot1Gear",
              "name": "参数组 2 档位",
              "offset": 5,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot1Speed",
              "name": "参数组 2 设定转速",
              "offset": 6,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot1Duration",
              "name": "参数组 2 R210A 时长",
              "offset": 8,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            },
            {
              "id": "slot2Gear",
              "name": "参数组 3 档位",
              "offset": 10,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot2Speed",
              "name": "参数组 3 设定转速",
              "offset": 11,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot2Duration",
              "name": "参数组 3 R210A 时长",
              "offset": 13,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            },
            {
              "id": "slot3Gear",
              "name": "参数组 4 档位",
              "offset": 15,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot3Speed",
              "name": "参数组 4 设定转速",
              "offset": 16,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot3Duration",
              "name": "参数组 4 R210A 时长",
              "offset": 18,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            },
            {
              "id": "slot4Gear",
              "name": "参数组 5 档位",
              "offset": 20,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot4Speed",
              "name": "参数组 5 设定转速",
              "offset": 21,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot4Duration",
              "name": "参数组 5 R210A 时长",
              "offset": 23,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            },
            {
              "id": "slot5Gear",
              "name": "参数组 6 档位",
              "offset": 25,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot5Speed",
              "name": "参数组 6 设定转速",
              "offset": 26,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot5Duration",
              "name": "参数组 6 R210A 时长",
              "offset": 28,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            },
            {
              "id": "slot6Gear",
              "name": "参数组 7 档位",
              "offset": 30,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot6Speed",
              "name": "参数组 7 设定转速",
              "offset": 31,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot6Duration",
              "name": "参数组 7 R210A 时长",
              "offset": 33,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            },
            {
              "id": "slot7Gear",
              "name": "参数组 8 档位",
              "offset": 35,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "A",
                "1": "1",
                "2": "2",
                "3": "3",
                "4": "4",
                "5": "5",
                "6": "6",
                "7": "S"
              }
            },
            {
              "id": "slot7Speed",
              "name": "参数组 8 设定转速",
              "offset": 36,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            },
            {
              "id": "slot7Duration",
              "name": "参数组 8 R210A 时长",
              "offset": 38,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "ms",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 2C D3 73 0003E800C801044C00D20204B000DC03051400E604057800F00505DC00FA06064001040706A4010E",
              "expected": {
                "slot0Gear": "A",
                "slot0Speed": "1000",
                "slot0Duration": "200",
                "slot1Gear": "1",
                "slot1Speed": "1100",
                "slot1Duration": "210",
                "slot2Gear": "2",
                "slot2Speed": "1200",
                "slot2Duration": "220",
                "slot3Gear": "3",
                "slot3Speed": "1300",
                "slot3Duration": "230",
                "slot4Gear": "4",
                "slot4Speed": "1400",
                "slot4Duration": "240",
                "slot5Gear": "5",
                "slot5Speed": "1500",
                "slot5Duration": "250",
                "slot6Gear": "6",
                "slot6Speed": "1600",
                "slot6Duration": "260",
                "slot7Gear": "S",
                "slot7Speed": "1700",
                "slot7Duration": "270"
              }
            }
          ]
        },
        {
          "id": "valve",
          "name": "阀类型（含配置状态）",
          "operation": "read",
          "enabled": true,
          "queryCode": "74",
          "responseCode": "74",
          "payloadLength": 2,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "status",
              "name": "阀类型配置状态",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "阀类型配置有效",
                "1": "未配置阀类型，无法读取/判断",
                "2": "阀类型配置冲突"
              }
            },
            {
              "id": "value",
              "name": "阀类型",
              "offset": 1,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "MAC 阀",
                "1": "方阀",
                "255": "无有效阀类型"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 06 F9 74 00 00",
              "expected": {
                "status": "阀类型配置有效",
                "value": "MAC 阀"
              }
            },
            {
              "frameHex": "F5 06 F9 74 00 01",
              "expected": {
                "status": "阀类型配置有效",
                "value": "方阀"
              }
            },
            {
              "frameHex": "F5 06 F9 74 01 FF",
              "expected": {
                "status": "未配置阀类型，无法读取/判断",
                "value": "无有效阀类型"
              }
            },
            {
              "frameHex": "F5 06 F9 74 02 FF",
              "expected": {
                "status": "阀类型配置冲突",
                "value": "无有效阀类型"
              }
            },
            {
              "frameHex": "F5 06 F9 74 00 FF",
              "expected": {
                "status": "阀类型配置有效",
                "value": "无有效阀类型"
              }
            }
          ]
        },
        {
          "id": "debug",
          "name": "Debug 状态",
          "operation": "read",
          "enabled": true,
          "queryCode": "75",
          "responseCode": "75",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "0",
                "1": "1"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 75 00",
              "expected": {
                "value": "0"
              }
            }
          ]
        },
        {
          "id": "usage",
          "name": "累计使用时长",
          "operation": "read",
          "enabled": true,
          "queryCode": "76",
          "responseCode": "76",
          "payloadLength": 4,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 4,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 60,
              "bias": 0,
              "unit": "小时",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 08 F7 76 00 03 25 3C",
              "expected": {
                "value": "3435.6666666666666666666666667"
              }
            }
          ]
        },
        {
          "id": "alarms",
          "name": "当前报警（数量与编号）",
          "operation": "read",
          "enabled": true,
          "queryCode": "77",
          "responseCode": "77",
          "payloadLength": 24,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "count",
              "name": "数量",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "条",
              "prefix": ""
            },
            {
              "id": "codes",
              "name": "报警编号",
              "offset": 1,
              "length": 1,
              "type": "countedEnum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "编号 0x00（含义未配置）",
                "1": "0x01 氧浓度低于82%",
                "2": "0x02 氧浓度长期低于82%",
                "3": "0x03 氧浓度82～86%",
                "4": "0x04 氧浓度无数据",
                "5": "0x05 机器内部温度过高",
                "6": "0x06 机器内部温度过低",
                "7": "0x07 机器温度传感器无数据",
                "8": "0x08 电池严重低电量",
                "9": "0x09 电池低电量",
                "10": "0x0A 电池10%低电量状态",
                "11": "0x0B 电池温度过高",
                "12": "0x0C 电池高温关机",
                "13": "0x0D 电池温度无数据",
                "14": "0x0E 电池电量数据异常",
                "15": "0x0F 压力过高",
                "16": "0x10 严重过压",
                "17": "0x11 大气压传感器异常",
                "18": "0x12 微压传感器异常",
                "19": "0x13 无呼吸",
                "20": "0x14 压缩机转速无反馈",
                "21": "0x15 R210阀工作异常",
                "22": "0x16 风扇转速无反馈",
                "23": "0x17 微压模块温度过高关机",
                "24": "编号 0x18（含义未配置）",
                "25": "编号 0x19（含义未配置）",
                "26": "编号 0x1A（含义未配置）",
                "27": "编号 0x1B（含义未配置）",
                "28": "编号 0x1C（含义未配置）",
                "29": "编号 0x1D（含义未配置）",
                "30": "编号 0x1E（含义未配置）",
                "31": "编号 0x1F（含义未配置）",
                "32": "编号 0x20（含义未配置）",
                "33": "编号 0x21（含义未配置）",
                "34": "编号 0x22（含义未配置）",
                "35": "编号 0x23（含义未配置）",
                "36": "编号 0x24（含义未配置）",
                "37": "编号 0x25（含义未配置）",
                "38": "编号 0x26（含义未配置）",
                "39": "编号 0x27（含义未配置）",
                "40": "编号 0x28（含义未配置）",
                "41": "编号 0x29（含义未配置）",
                "42": "编号 0x2A（含义未配置）",
                "43": "编号 0x2B（含义未配置）",
                "44": "编号 0x2C（含义未配置）",
                "45": "编号 0x2D（含义未配置）",
                "46": "编号 0x2E（含义未配置）",
                "47": "编号 0x2F（含义未配置）",
                "48": "编号 0x30（含义未配置）",
                "49": "编号 0x31（含义未配置）",
                "50": "编号 0x32（含义未配置）",
                "51": "编号 0x33（含义未配置）",
                "52": "编号 0x34（含义未配置）",
                "53": "编号 0x35（含义未配置）",
                "54": "编号 0x36（含义未配置）",
                "55": "编号 0x37（含义未配置）",
                "56": "编号 0x38（含义未配置）",
                "57": "编号 0x39（含义未配置）",
                "58": "编号 0x3A（含义未配置）",
                "59": "编号 0x3B（含义未配置）",
                "60": "编号 0x3C（含义未配置）",
                "61": "编号 0x3D（含义未配置）",
                "62": "编号 0x3E（含义未配置）",
                "63": "编号 0x3F（含义未配置）",
                "64": "编号 0x40（含义未配置）",
                "65": "编号 0x41（含义未配置）",
                "66": "编号 0x42（含义未配置）",
                "67": "编号 0x43（含义未配置）",
                "68": "编号 0x44（含义未配置）",
                "69": "编号 0x45（含义未配置）",
                "70": "编号 0x46（含义未配置）",
                "71": "编号 0x47（含义未配置）",
                "72": "编号 0x48（含义未配置）",
                "73": "编号 0x49（含义未配置）",
                "74": "编号 0x4A（含义未配置）",
                "75": "编号 0x4B（含义未配置）",
                "76": "编号 0x4C（含义未配置）",
                "77": "编号 0x4D（含义未配置）",
                "78": "编号 0x4E（含义未配置）",
                "79": "编号 0x4F（含义未配置）",
                "80": "编号 0x50（含义未配置）",
                "81": "编号 0x51（含义未配置）",
                "82": "编号 0x52（含义未配置）",
                "83": "编号 0x53（含义未配置）",
                "84": "编号 0x54（含义未配置）",
                "85": "编号 0x55（含义未配置）",
                "86": "编号 0x56（含义未配置）",
                "87": "编号 0x57（含义未配置）",
                "88": "编号 0x58（含义未配置）",
                "89": "编号 0x59（含义未配置）",
                "90": "编号 0x5A（含义未配置）",
                "91": "编号 0x5B（含义未配置）",
                "92": "编号 0x5C（含义未配置）",
                "93": "编号 0x5D（含义未配置）",
                "94": "编号 0x5E（含义未配置）",
                "95": "编号 0x5F（含义未配置）",
                "96": "编号 0x60（含义未配置）",
                "97": "编号 0x61（含义未配置）",
                "98": "编号 0x62（含义未配置）",
                "99": "编号 0x63（含义未配置）",
                "100": "编号 0x64（含义未配置）",
                "101": "编号 0x65（含义未配置）",
                "102": "编号 0x66（含义未配置）",
                "103": "编号 0x67（含义未配置）",
                "104": "编号 0x68（含义未配置）",
                "105": "编号 0x69（含义未配置）",
                "106": "编号 0x6A（含义未配置）",
                "107": "编号 0x6B（含义未配置）",
                "108": "编号 0x6C（含义未配置）",
                "109": "编号 0x6D（含义未配置）",
                "110": "编号 0x6E（含义未配置）",
                "111": "编号 0x6F（含义未配置）",
                "112": "编号 0x70（含义未配置）",
                "113": "编号 0x71（含义未配置）",
                "114": "编号 0x72（含义未配置）",
                "115": "编号 0x73（含义未配置）",
                "116": "编号 0x74（含义未配置）",
                "117": "编号 0x75（含义未配置）",
                "118": "编号 0x76（含义未配置）",
                "119": "编号 0x77（含义未配置）",
                "120": "编号 0x78（含义未配置）",
                "121": "编号 0x79（含义未配置）",
                "122": "编号 0x7A（含义未配置）",
                "123": "编号 0x7B（含义未配置）",
                "124": "编号 0x7C（含义未配置）",
                "125": "编号 0x7D（含义未配置）",
                "126": "编号 0x7E（含义未配置）",
                "127": "编号 0x7F（含义未配置）",
                "128": "编号 0x80（含义未配置）",
                "129": "编号 0x81（含义未配置）",
                "130": "编号 0x82（含义未配置）",
                "131": "编号 0x83（含义未配置）",
                "132": "编号 0x84（含义未配置）",
                "133": "编号 0x85（含义未配置）",
                "134": "编号 0x86（含义未配置）",
                "135": "编号 0x87（含义未配置）",
                "136": "编号 0x88（含义未配置）",
                "137": "编号 0x89（含义未配置）",
                "138": "编号 0x8A（含义未配置）",
                "139": "编号 0x8B（含义未配置）",
                "140": "编号 0x8C（含义未配置）",
                "141": "编号 0x8D（含义未配置）",
                "142": "编号 0x8E（含义未配置）",
                "143": "编号 0x8F（含义未配置）",
                "144": "编号 0x90（含义未配置）",
                "145": "编号 0x91（含义未配置）",
                "146": "编号 0x92（含义未配置）",
                "147": "编号 0x93（含义未配置）",
                "148": "编号 0x94（含义未配置）",
                "149": "编号 0x95（含义未配置）",
                "150": "编号 0x96（含义未配置）",
                "151": "编号 0x97（含义未配置）",
                "152": "编号 0x98（含义未配置）",
                "153": "编号 0x99（含义未配置）",
                "154": "编号 0x9A（含义未配置）",
                "155": "编号 0x9B（含义未配置）",
                "156": "编号 0x9C（含义未配置）",
                "157": "编号 0x9D（含义未配置）",
                "158": "编号 0x9E（含义未配置）",
                "159": "编号 0x9F（含义未配置）",
                "160": "编号 0xA0（含义未配置）",
                "161": "编号 0xA1（含义未配置）",
                "162": "编号 0xA2（含义未配置）",
                "163": "编号 0xA3（含义未配置）",
                "164": "编号 0xA4（含义未配置）",
                "165": "编号 0xA5（含义未配置）",
                "166": "编号 0xA6（含义未配置）",
                "167": "编号 0xA7（含义未配置）",
                "168": "编号 0xA8（含义未配置）",
                "169": "编号 0xA9（含义未配置）",
                "170": "编号 0xAA（含义未配置）",
                "171": "编号 0xAB（含义未配置）",
                "172": "编号 0xAC（含义未配置）",
                "173": "编号 0xAD（含义未配置）",
                "174": "编号 0xAE（含义未配置）",
                "175": "编号 0xAF（含义未配置）",
                "176": "编号 0xB0（含义未配置）",
                "177": "编号 0xB1（含义未配置）",
                "178": "编号 0xB2（含义未配置）",
                "179": "编号 0xB3（含义未配置）",
                "180": "编号 0xB4（含义未配置）",
                "181": "编号 0xB5（含义未配置）",
                "182": "编号 0xB6（含义未配置）",
                "183": "编号 0xB7（含义未配置）",
                "184": "编号 0xB8（含义未配置）",
                "185": "编号 0xB9（含义未配置）",
                "186": "编号 0xBA（含义未配置）",
                "187": "编号 0xBB（含义未配置）",
                "188": "编号 0xBC（含义未配置）",
                "189": "编号 0xBD（含义未配置）",
                "190": "编号 0xBE（含义未配置）",
                "191": "编号 0xBF（含义未配置）",
                "192": "编号 0xC0（含义未配置）",
                "193": "编号 0xC1（含义未配置）",
                "194": "编号 0xC2（含义未配置）",
                "195": "编号 0xC3（含义未配置）",
                "196": "编号 0xC4（含义未配置）",
                "197": "编号 0xC5（含义未配置）",
                "198": "编号 0xC6（含义未配置）",
                "199": "编号 0xC7（含义未配置）",
                "200": "编号 0xC8（含义未配置）",
                "201": "编号 0xC9（含义未配置）",
                "202": "编号 0xCA（含义未配置）",
                "203": "编号 0xCB（含义未配置）",
                "204": "编号 0xCC（含义未配置）",
                "205": "编号 0xCD（含义未配置）",
                "206": "编号 0xCE（含义未配置）",
                "207": "编号 0xCF（含义未配置）",
                "208": "编号 0xD0（含义未配置）",
                "209": "编号 0xD1（含义未配置）",
                "210": "编号 0xD2（含义未配置）",
                "211": "编号 0xD3（含义未配置）",
                "212": "编号 0xD4（含义未配置）",
                "213": "编号 0xD5（含义未配置）",
                "214": "编号 0xD6（含义未配置）",
                "215": "编号 0xD7（含义未配置）",
                "216": "编号 0xD8（含义未配置）",
                "217": "编号 0xD9（含义未配置）",
                "218": "编号 0xDA（含义未配置）",
                "219": "编号 0xDB（含义未配置）",
                "220": "编号 0xDC（含义未配置）",
                "221": "编号 0xDD（含义未配置）",
                "222": "编号 0xDE（含义未配置）",
                "223": "编号 0xDF（含义未配置）",
                "224": "编号 0xE0（含义未配置）",
                "225": "编号 0xE1（含义未配置）",
                "226": "编号 0xE2（含义未配置）",
                "227": "编号 0xE3（含义未配置）",
                "228": "编号 0xE4（含义未配置）",
                "229": "编号 0xE5（含义未配置）",
                "230": "编号 0xE6（含义未配置）",
                "231": "编号 0xE7（含义未配置）",
                "232": "编号 0xE8（含义未配置）",
                "233": "编号 0xE9（含义未配置）",
                "234": "编号 0xEA（含义未配置）",
                "235": "编号 0xEB（含义未配置）",
                "236": "编号 0xEC（含义未配置）",
                "237": "编号 0xED（含义未配置）",
                "238": "编号 0xEE（含义未配置）",
                "239": "编号 0xEF（含义未配置）",
                "240": "编号 0xF0（含义未配置）",
                "241": "编号 0xF1（含义未配置）",
                "242": "编号 0xF2（含义未配置）",
                "243": "编号 0xF3（含义未配置）",
                "244": "编号 0xF4（含义未配置）",
                "245": "编号 0xF5（含义未配置）",
                "246": "编号 0xF6（含义未配置）",
                "247": "编号 0xF7（含义未配置）",
                "248": "编号 0xF8（含义未配置）",
                "249": "编号 0xF9（含义未配置）",
                "250": "编号 0xFA（含义未配置）",
                "251": "编号 0xFB（含义未配置）",
                "252": "编号 0xFC（含义未配置）",
                "253": "编号 0xFD（含义未配置）",
                "254": "编号 0xFE（含义未配置）",
                "255": "编号 0xFF（含义未配置）"
              },
              "countOffset": 0,
              "maxCount": 23
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 77 00",
              "expected": {
                "count": "0",
                "codes": "无"
              }
            },
            {
              "frameHex": "F5 06 F9 77 01 13",
              "expected": {
                "count": "1",
                "codes": "0x13 无呼吸"
              }
            },
            {
              "frameHex": "F5 07 F8 77 02 01 13",
              "expected": {
                "count": "2",
                "codes": "0x01 氧浓度低于82%、0x13 无呼吸"
              }
            },
            {
              "frameHex": "F5 09 F6 77 04 01 05 13 16",
              "expected": {
                "count": "4",
                "codes": "0x01 氧浓度低于82%、0x05 机器内部温度过高、0x13 无呼吸、0x16 风扇转速无反馈"
              }
            },
            {
              "frameHex": "F5 1C E3 77 17 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 10 11 12 13 14 15 16 17",
              "expected": {
                "count": "23",
                "codes": "0x01 氧浓度低于82%、0x02 氧浓度长期低于82%、0x03 氧浓度82～86%、0x04 氧浓度无数据、0x05 机器内部温度过高、0x06 机器内部温度过低、0x07 机器温度传感器无数据、0x08 电池严重低电量、0x09 电池低电量、0x0A 电池10%低电量状态、0x0B 电池温度过高、0x0C 电池高温关机、0x0D 电池温度无数据、0x0E 电池电量数据异常、0x0F 压力过高、0x10 严重过压、0x11 大气压传感器异常、0x12 微压传感器异常、0x13 无呼吸、0x14 压缩机转速无反馈、0x15 R210阀工作异常、0x16 风扇转速无反馈、0x17 微压模块温度过高关机"
              }
            }
          ]
        },
        {
          "id": "pressure-check",
          "name": "压力传感器数值（含有效状态）",
          "operation": "read",
          "enabled": true,
          "queryCode": "78",
          "responseCode": "78",
          "payloadLength": 3,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "status",
              "name": "数据状态",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "数据有效",
                "1": "测量未完成",
                "2": "传感器无数据/异常"
              }
            },
            {
              "id": "value",
              "name": "值",
              "offset": 1,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "kPa",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 07 F8 78 00 00 AD",
              "expected": {
                "status": "数据有效",
                "value": "173"
              }
            },
            {
              "frameHex": "F5 07 F8 78 01 00 00",
              "expected": {
                "status": "测量未完成",
                "value": "0"
              }
            },
            {
              "frameHex": "F5 07 F8 78 02 00 00",
              "expected": {
                "status": "传感器无数据/异常",
                "value": "0"
              }
            }
          ]
        },
        {
          "id": "temperature-check",
          "name": "内部温度（含有效状态）",
          "operation": "read",
          "enabled": true,
          "queryCode": "79",
          "responseCode": "79",
          "payloadLength": 3,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "status",
              "name": "数据状态",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "数据有效",
                "1": "测量未完成",
                "2": "传感器无数据/异常"
              }
            },
            {
              "id": "value",
              "name": "值",
              "offset": 1,
              "length": 2,
              "type": "int",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "℃",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 07 F8 79 00 FF FB",
              "expected": {
                "status": "数据有效",
                "value": "-5"
              }
            },
            {
              "frameHex": "F5 07 F8 79 01 00 00",
              "expected": {
                "status": "测量未完成",
                "value": "0"
              }
            },
            {
              "frameHex": "F5 07 F8 79 02 00 00",
              "expected": {
                "status": "传感器无数据/异常",
                "value": "0"
              }
            }
          ]
        },
        {
          "id": "fan",
          "name": "风扇实际反馈比例",
          "operation": "read",
          "enabled": true,
          "queryCode": "7A",
          "responseCode": "7A",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "%",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 7A 2D",
              "expected": {
                "value": "45"
              }
            }
          ]
        },
        {
          "id": "compressor",
          "name": "压缩机状态",
          "operation": "read",
          "enabled": true,
          "queryCode": "7B",
          "responseCode": "7B",
          "payloadLength": 3,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "gear",
              "name": "档位",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            },
            {
              "id": "speed",
              "name": "转速",
              "offset": 1,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "rpm",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 07 F8 7B 07 0D E8",
              "expected": {
                "gear": "7",
                "speed": "3560"
              }
            }
          ]
        },
        {
          "id": "restarts",
          "name": "压缩机异常自动重启次数",
          "operation": "read",
          "enabled": true,
          "queryCode": "7C",
          "responseCode": "7C",
          "payloadLength": 2,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 2,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "次",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 06 F9 7C 00 00",
              "expected": {
                "value": "0"
              }
            }
          ]
        },
        {
          "id": "valve-pressure",
          "name": "微压/V 压差值平均值（无单位）",
          "operation": "read",
          "enabled": true,
          "queryCode": "7D",
          "responseCode": "7D",
          "payloadLength": 2,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "有符号原始值",
              "offset": 0,
              "length": 2,
              "type": "int",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 06 F9 7D 00 23",
              "expected": {
                "value": "35"
              }
            },
            {
              "frameHex": "F5 06 F9 7D FF FB",
              "expected": {
                "value": "-5"
              }
            }
          ]
        },
        {
          "id": "valve-temperature",
          "name": "V 温度",
          "operation": "read",
          "enabled": true,
          "queryCode": "7E",
          "responseCode": "7E",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "℃",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 7E 21",
              "expected": {
                "value": "33"
              }
            }
          ]
        },
        {
          "id": "sensitivity",
          "name": "已保存灵敏度",
          "operation": "read",
          "enabled": true,
          "queryCode": "7F",
          "responseCode": "7F",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 7F 03",
              "expected": {
                "value": "3"
              }
            }
          ]
        },
        {
          "id": "volume",
          "name": "已保存音量",
          "operation": "read",
          "enabled": true,
          "queryCode": "80",
          "responseCode": "80",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 80 03",
              "expected": {
                "value": "3"
              }
            }
          ]
        },
        {
          "id": "fpga",
          "name": "FPGA 版本",
          "operation": "read",
          "enabled": true,
          "queryCode": "82",
          "responseCode": "82",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 82 25",
              "expected": {
                "value": "37"
              }
            }
          ]
        },
        {
          "id": "calibration230",
          "name": "230 校准状态",
          "operation": "read",
          "enabled": true,
          "queryCode": "83",
          "responseCode": "83",
          "payloadLength": 3,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "status",
              "name": "状态",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "未完成",
                "1": "已完成"
              }
            },
            {
              "id": "value",
              "name": "230 抹平值原始字节（符号与解释待确认）",
              "offset": 1,
              "length": 2,
              "type": "hex",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "HEX "
            }
          ],
          "samples": [
            {
              "frameHex": "F5 07 F8 83 01 00 0B",
              "expected": {
                "status": "已完成",
                "value": "HEX 000B"
              }
            }
          ]
        },
        {
          "id": "calibration232",
          "name": "232 状态",
          "operation": "read",
          "enabled": true,
          "queryCode": "84",
          "responseCode": "84",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "enum",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": "",
              "enumValues": {
                "0": "未完成",
                "1": "已完成"
              }
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 84 01",
              "expected": {
                "value": "已完成"
              }
            }
          ]
        },
        {
          "id": "pressure",
          "name": "当前大气压",
          "operation": "read",
          "enabled": true,
          "queryCode": "85",
          "responseCode": "85",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "kPa",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 85 65",
              "expected": {
                "value": "101"
              }
            }
          ]
        },
        {
          "id": "delivery",
          "name": "当前档位（RAM）",
          "operation": "read",
          "enabled": true,
          "queryCode": "86",
          "responseCode": "86",
          "payloadLength": 1,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "value",
              "name": "值",
              "offset": 0,
              "length": 1,
              "type": "uint",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "unit": "档",
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 05 FA 86 03",
              "expected": {
                "value": "3"
              }
            }
          ]
        },
        {
          "id": "uid",
          "name": "STM32 UID（CRC-32/ISO-HDLC）",
          "operation": "read",
          "enabled": true,
          "queryCode": "87",
          "responseCode": "87",
          "payloadLength": 16,
          "timeoutMs": 1500,
          "fields": [
            {
              "id": "uid",
              "name": "完整 96 位 UID",
              "offset": 0,
              "length": 12,
              "type": "hex",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            },
            {
              "id": "shortUid",
              "name": "短 UID（CRC32）",
              "offset": 12,
              "length": 4,
              "type": "hex",
              "endian": "big",
              "scale": 1,
              "divisor": 1,
              "bias": 0,
              "prefix": ""
            }
          ],
          "samples": [
            {
              "frameHex": "F5 14 EB 87 6D 00 4E 00 34 51 33 30 34 36 30 36 A5 E2 BB 25",
              "expected": {
                "uid": "6D004E003451333034363036",
                "shortUid": "A5E2BB25"
              }
            }
          ]
        }
      ]
    }
  ]
};

export const FACTORY_SERIAL_DEFAULT: FactorySerialConfig = {
  "schemaVersion": 1,
  "version": "serial-config-003",
  "autoConnect": true,
  "portName": "auto",
  "baudRate": 9600,
  "dataBits": 8,
  "parity": "None",
  "stopBits": "One",
  "handshake": "None",
  "dtrEnable": true,
  "rtsEnable": false,
  "queryTimeoutMs": 1500,
  "scanIntervalMs": 1000,
  "retryDelayMs": 5000
};

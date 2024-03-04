import { md5 } from './constants';

export enum Platform {
  Linux,
  MacOS,
  Windows,
}

export type AppInfo = typeof linux;
export type DeviceInfo = ReturnType<typeof generateDeviceInfo>;

const linux = {
  os: 'Linux',
  kernel: 'Linux',
  vendorOs: 'linux',

  currentVersion: '3.1.2-13107',
  buildVersion: 13107,
  miscBitmap: 32764,
  ptVersion: '2.0.0',
  ptOsVersion: 19,
  packageName: 'com.tencent.qq',
  wtLoginSdk: 'nt.wtlogin.0.0.1',
  packageSign: 'V1_LNX_NQ_3.1.2-13107_RDM_B',
  appId: 1600001615,
  subAppId: 537146866,
  appIdQrCode: 13697054,
  appClientVersion: 13172,

  mainSigMap: 169742560,
  subSigMap: 0,
  NTLoginType: 1,
};

const macOS: AppInfo = {
  os: 'Mac',
  kernel: 'Darwin',
  vendorOs: 'mac',

  currentVersion: '6.9.20-17153',
  buildVersion: 17153,
  ptVersion: '2.0.0',
  miscBitmap: 32764,
  ptOsVersion: 23,
  packageName: 'com.tencent.qq',
  wtLoginSdk: 'nt.wtlogin.0.0.1',
  packageSign: 'V1_MAC_NQ_6.9.20-17153_RDM_B',
  appId: 1600001602,
  subAppId: 537162356,
  appIdQrCode: 537162356,
  appClientVersion: 13172,

  mainSigMap: 169742560,
  subSigMap: 0,
  NTLoginType: 5,
};

const appList: { [platform in Platform]: AppInfo } = {
  [Platform.Windows]: linux, // TODO: AppInfo for windows
  [Platform.Linux]: linux,
  [Platform.MacOS]: macOS,
};

export function getAppInfo(p: Platform): AppInfo {
  return appList[p] || appList[Platform.Linux];
}

export function generateDeviceInfo(uin: string | number) {
  const guid = typeof uin === 'string' ? uin : md5(uin.toString()).toString('hex');
  return {
    guid: guid,
    deviceName: `Lagrange-${Buffer.from(md5(guid.toString()).slice(0, 3)).toString('hex').toUpperCase()}`,
    systemKernel: 'Windows 10.0.19042',
    kernelVersion: '10.0.19042.0',
  };
}

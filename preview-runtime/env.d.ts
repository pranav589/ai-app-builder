// react-native-web ships without types; the preview runtime treats it loosely.
declare module "react-native-web" {
  const RN: any // eslint-disable-line @typescript-eslint/no-explicit-any
  export = RN
}

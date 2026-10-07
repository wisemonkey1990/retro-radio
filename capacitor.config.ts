import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.retroradio.app',
  appName: '复古电台',
  webDir: 'dist',
  server: { androidScheme: 'https' },
}

export default config

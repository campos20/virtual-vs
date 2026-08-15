# BLE-MIDI footswitch (not implemented)

This folder is a placeholder. `types.ts` defines `PedalMapping` (persisted in
`src/store/pedalMappingsSlice.ts`) so the rest of the app has a stable shape
to design against, but no BLE code exists yet and **`react-native-ble-plx` is
intentionally not installed**.

## TODO: exact steps to add BLE-MIDI support later

1. **Install**: `npx expo install react-native-ble-plx`. It's a native
   module - after installing you must rebuild the dev client
   (`npx expo run:ios` / `npx expo run:android`), a plain JS reload isn't
   enough.

2. **Config plugin**: add to `app.json`'s `expo.plugins`:
   ```json
   [
     "react-native-ble-plx",
     {
       "isBackgroundEnabled": true,
       "modes": ["central"],
       "bluetoothAlwaysPermission": "Allow $(PRODUCT_NAME) to connect to your BLE-MIDI footswitch"
     }
   ]
   ```
   `modes: ["central"]` is enough - the app only *connects to* a footswitch,
   it never advertises itself as a BLE peripheral.

3. **Android permissions**: the plugin adds `BLUETOOTH_SCAN` /
   `BLUETOOTH_CONNECT` to the manifest, but on API 31+ they still need a
   runtime permission request before scanning (`PermissionsAndroid.request`
   for both, plus location permission on older Android versions where BLE
   scan requires it).

4. **BLE-MIDI is not "parsed MIDI over BLE" for free** - `ble-plx` only gives
   you raw bytes from a GATT characteristic. Implement against the MMA
   BLE-MIDI spec:
   - Service UUID: `03B80E5A-EDE8-4B33-A751-6CE34EC4C700`
   - Characteristic UUID: `7772E5DB-3868-4112-A1A9-F2669D106BF3`
   - Each notified value is a BLE-MIDI packet: a header byte, then one or
     more (timestamp byte, MIDI message bytes) groups. A footswitch sending
     Note On/Off or Program Change is the common case - decode just enough
     of the spec to pull out note number / program number, don't need a full
     MIDI parser.

5. **Wire it up**: on receiving a decoded MIDI event, look it up against
   `pedalMappingsSlice` entries by `midiNote`, then dispatch the mapped
   `PedalAction` (play/pause, next section, etc.) - most of these actions
   are calls straight into `AudioEngine` (see `src/engine/AudioEngine.ts`),
   the same calls the transport UI buttons already make.

6. **Pairing/connection UI**: a screen to scan (`bleManager.startDeviceScan`),
   connect, and persist the last-connected device id (in `settingsSlice`)
   so the app can auto-reconnect on launch.

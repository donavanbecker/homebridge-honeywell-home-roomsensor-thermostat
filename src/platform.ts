import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { interval } from 'rxjs';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import * as qs from 'querystring';
import { readFileSync, writeFileSync } from 'fs';
import { PLATFORM_NAME, PLUGIN_NAME, AuthURL, LocationURL, DeviceURL, UIurl } from './settings';
import { RoomSensorThermostat } from './RoomSensors/roomSensorThermostat';
import {
  location,
  sensoraccessory,
  accessoryAttribute,
  T9Thermostat,
  T9groups,
  inBuiltSensorState,
  Settings,
  HoneywellPlatformConfig,
} from './configTypes';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class RoomSensorThermostatPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];

  public axios: AxiosInstance = axios.create({
    responseType: 'json',
  });

  locations?;
  firmware!: accessoryAttribute['softwareRevision'];
  sensoraccessory!: sensoraccessory;

  constructor(public readonly log: Logger, public readonly config: HoneywellPlatformConfig, public readonly api: API) {
    this.log.debug('Finished initializing platform:', this.config.name);
    // only load if configured
    if (!this.config) {
      return;
    }

    // verify the config
    try {
      this.verifyConfig();
      this.log.debug('Config OK');
    } catch (e) {
      this.log.error(JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    }

    // setup axios interceptor to add headers / api key to each request
    this.axios.interceptors.request.use((request: AxiosRequestConfig) => {
      request.headers.Authorization = `Bearer ${this.config.credentials?.accessToken}`;
      request.params = request.params || {};
      request.params.apikey = this.config.credentials?.consumerKey;
      request.headers['Content-Type'] = 'application/json';
      return request;
    });

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      interval((1800 / 3) * 1000).subscribe(async () => {
        try {
          await this.getAccessToken();
        } catch (e) {
          this.log.error('Failed to refresh access token.', JSON.stringify(e.message));
          this.log.debug(JSON.stringify(e));
        }
      });
      try {
        this.locations = await this.discoverlocations();
      } catch (e) {
        this.log.error('Failed to Discover Locations.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
      try {
        this.discoverDevices();
      } catch (e) {
        this.log.error('Failed to Discover Devices.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * Verify the config passed to the plugin is valid
   */
  verifyConfig() {
    /**
     * Hidden Device Discovery Option - This will disable adding any device and will just output info.
     */
    this.config.devicediscovery;

    this.config.options = this.config.options || {};

    if (this.config.options?.thermostat) {
      // Thermostat Config Options
      this.config.options.thermostat.hide;
      this.config.options.thermostat.hide_fan;
      this.config.options.thermostat.thermostatSetpointStatus =
        this.config.options.thermostat.thermostatSetpointStatus || 'PermanentHold';
    }

    if (this.config.options?.leaksensor) {
      // Leak Sensor Config Options
      this.config.options.leaksensor.hide;
      this.config.options.leaksensor.hide_humidity;
      this.config.options.leaksensor.hide_temperature;
      this.config.options.leaksensor.hide_leak;
    }

    if (this.config.options?.roomsensor) {
      // Room Sensor Config Options
      this.config.options.roomsensor.hide;
      this.config.options.roomsensor.hide_temperature;
      this.config.options.roomsensor.hide_occupancy;
      this.config.options.roomsensor.hide_motion;
      this.config.options.roomsensor.hide_humidity;
    }

    if (this.config.options?.roompriority) {
      // Room Priority Config Options
      this.config.options.roompriority.thermostat;
      this.config.options.roompriority.priorityType = this.config.options.roompriority.priorityType || 'PickARoom';

      /**
       * Room Priority
       * This will display what room priority option that has been selected.
       */

      if (this.config.options.roompriority.thermostat) {
        this.log.warn('Displaying Room Sensors as Thermostat(s).');
        this.log.warn('You will have a Thermostat for Each Room Sensor so that you can set the priority of that Room.');
      }
      if (!this.config.options.roompriority.thermostat) {
        this.log.warn('Only Displaying Room Sensors.');
      }
    }

    if (this.config.options) {
      this.config.options.ttl = this.config.options!.ttl || 300; // default 300 seconds
    }

    if (!this.config.credentials?.consumerSecret && this.config.options!.ttl! < 300) {
      this.log.debug('TTL must be set to 300 or higher unless you setup your own consumerSecret.');
      this.config.options!.ttl! = 300;
    }

    if (!this.config.credentials) {
      throw new Error('Missing Credentials');
    }
    if (!this.config.credentials.consumerKey) {
      throw new Error('Missing consumerKey');
    }
    if (!this.config.credentials.refreshToken) {
      throw new Error('Missing refreshToken');
    }
  }

  /**
   * Exchange the refresh token for an access token
   */
  async getAccessToken() {
    let result: { access_token: any; refresh_token: string; };

    if (this.config.credentials!.consumerSecret) {
      result = (
        await axios({
          url: AuthURL,
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          auth: {
            username: this.config.credentials!.consumerKey,
            password: this.config.credentials!.consumerSecret,
          },
          data: qs.stringify({
            grant_type: 'refresh_token',
            refresh_token: this.config.credentials!.refreshToken,
          }),
          responseType: 'json',
        })
      ).data;
    } else {
      this.log.warn('Please re-link your account in the Homebridge UI.');
      // if no consumerSecret is defined, attempt to use the shared consumerSecret
      try {
        result = (
          await axios.post(UIurl, {
            consumerKey: this.config.credentials!.consumerKey,
            refresh_token: this.config.credentials!.refreshToken,
          })
        ).data;
      } catch (e) {
        this.log.error('Failed to exchange refresh token for an access token.', JSON.stringify(e.message));
        this.log.debug(JSON.stringify(e));
        throw e;
      }
    }

    this.config.credentials!.accessToken = result.access_token;
    this.log.warn('Got access token:', this.config.credentials!.accessToken);

    // check if the refresh token has changed
    if (result.refresh_token !== this.config.credentials!.refreshToken) {
      this.log.warn('New refresh token:', result.refresh_token);
      await this.updateRefreshToken(result.refresh_token);
    }

    this.config.credentials!.refreshToken = result.refresh_token;
  }

  /**
   * The refresh token will periodically change.
   * This method saves the updated refresh token in the config.json file
   * @param newRefreshToken
   */
  async updateRefreshToken(newRefreshToken: string) {
    try {
      // check the new token was provided
      if (!newRefreshToken) {
        throw new Error('New token not provided');
      }

      // load in the current config
      const currentConfig = JSON.parse(readFileSync(this.api.user.configPath(), 'utf8'));

      // check the platforms section is an array before we do array things on it
      if (!Array.isArray(currentConfig.platforms)) {
        throw new Error('Cannot find platforms array in config');
      }

      // find this plugins current config
      const pluginConfig = currentConfig.platforms.find((x: { platform: string }) => x.platform === PLATFORM_NAME);

      if (!pluginConfig) {
        throw new Error(`Cannot find config for ${PLATFORM_NAME} in platforms array`);
      }

      // check the .credentials is an object before doing object things with it
      if (typeof pluginConfig.credentials !== 'object') {
        throw new Error('pluginConfig.credentials is not an object');
      }

      // set the refresh token
      pluginConfig.credentials.refreshToken = newRefreshToken;

      // save the config, ensuring we maintain pretty json
      writeFileSync(this.api.user.configPath(), JSON.stringify(currentConfig, null, 4));

      this.log.warn('Homebridge config.json has been updated with new refresh token.');
    } catch (e) {
      this.log.error('Failed to update refresh token in config:', JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
    }
  }

  /**
   * this method discovers the Locations
   */
  async discoverlocations() {
    // try and get the access token. If it fails stop here.
    try {
      await this.getAccessToken();
    } catch (e) {
      this.log.error('Failed to refresh access token.', JSON.stringify(e.message));
      this.log.debug(JSON.stringify(e));
      return;
    }
    const locations = (await this.axios.get(LocationURL)).data;
    this.log.info(`Total Locations Found: ${locations.length}`);
    return locations;
  }

  /**
   * this method discovers the rooms at each location
   */
  public async Sensors(device: T9Thermostat, group: T9groups, locationId: location['locationID']) {
    return (
      await this.axios.get(`${DeviceURL}/thermostats/${device.deviceID}/group/${group.id}/rooms`, {
        params: {
          locationId: locationId,
        },
      })
    ).data;
  }

  /**
   * This method is used to discover the your location and devices.
   * Accessories are registered by either their DeviceClass, DeviceModel, or DeviceID
   */
  private async discoverDevices() {
    if (this.locations) {
      // get the devices at each location
      for (const location of this.locations) {
        this.log.info(`Getting devices for ${location.name}...`);
        this.log.info(`Total Devices Found at ${location.name}: ${location.devices.length}`);
        this.log.debug(JSON.stringify(location));
        this.locationinfo(location);
        for (const device of location.devices) {
          if (device.isAlive && device.deviceClass === 'Thermostat') {
            if (device.deviceID.startsWith('LCC')) {
              if (device.deviceModel.startsWith('T9')) {
                this.deviceinfo(device);
                this.log.debug(JSON.stringify(device));
                try {
                  this.discoverRoomSensors();
                } catch (e) {
                  this.log.error('Failed to Find Room Sensors.', JSON.stringify(e.message));
                  this.log.debug(JSON.stringify(e));
                }
              } 
            } else {
              this.log.info(
                'A Device was found that is not supported, ',
                'Please open Feature Request Here: https://git.io/JURLY, ',
                'If you would like to see support.',
              );
            }
          }
        }
      }
    } else {
      this.log.error('Failed to Discover Locations. Re-Link Your Honeywell Home Account.');
    }
  }

  private async discoverRoomSensors() {
    // get the devices at each location
    for (const location of this.locations) {
      const locationId = location.locationID;
      for (const device of location.devices) {
        if (device.deviceID.startsWith('LCC')) {
          if (device.deviceModel.startsWith('T9')) {
            if (device.groups) {
              const groups = device.groups;
              for (const group of groups) {
                const roomsensors = await this.Sensors(device, group, locationId);
                if (roomsensors.rooms) {
                  const rooms = roomsensors.rooms;
                  this.log.debug(JSON.stringify(roomsensors));
                  if (this.config.options?.roompriority?.thermostat) {
                    this.log.info(`Total Rooms Found: ${rooms.length}`);
                  }
                  for (const accessories of rooms) {
                    if (accessories) {
                      this.log.debug(JSON.stringify(accessories));
                      for (const accessory of accessories.accessories) {
                        const sensoraccessory = accessory;
                        if (accessory.accessoryAttribute) {
                          if (accessory.accessoryAttribute.type) {
                            if (accessory.accessoryAttribute.type.startsWith('IndoorAirSensor')) {
                              this.log.debug(JSON.stringify(sensoraccessory));
                              this.log.debug(JSON.stringify(sensoraccessory.accessoryAttribute.name));
                              this.log.debug(JSON.stringify(sensoraccessory.accessoryAttribute.softwareRevision));
                              this.RoomSensorThermostat(device, locationId, sensoraccessory, group);
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  private RoomSensorThermostat(
    device: T9Thermostat,
    locationId: location['locationID'],
    sensoraccessory: sensoraccessory,
    group: T9groups,
  ) {
    const uuid = this.api.hap.uuid.generate(
      // eslint-disable-next-line max-len
      `${sensoraccessory.accessoryAttribute.name}-${sensoraccessory.accessoryAttribute.type}-${sensoraccessory.accessoryId}-RoomSensorThermostat-${device.deviceID}`,
    );

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.accessories.find((accessory: { UUID }) => accessory.UUID === uuid);

    if (existingAccessory) {
      // the accessory already exists
      if (device.isAlive && this.config.options?.roompriority?.thermostat) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.firmwareRevision = sensoraccessory.accessoryAttribute.softwareRevision;
        // existingAccessory.context.name = sensoraccessory.accessoryAttribute.name;
        // existingAccessory.context.type = sensoraccessory.accessoryAttribute.type;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new RoomSensorThermostat(this, existingAccessory, locationId, device, sensoraccessory, group);
        this.log.debug(
          // eslint-disable-next-line max-len
          `Room Sensor Thermostat UDID: ${sensoraccessory.accessoryAttribute.name}-${sensoraccessory.accessoryAttribute.type}-${sensoraccessory.accessoryId}-RoomSensorThermostat-${device.deviceID}`,
        );
      } else if (!device.isAlive || !this.config.options?.roompriority?.thermostat) {
        this.unregisterPlatformAccessories(existingAccessory);
      }
    } else if (device.isAlive && this.config.options?.roompriority?.thermostat) {
      // the accessory does not yet exist, so we need to create it
      this.log.info(
        'Adding new accessory:',
        `${sensoraccessory.accessoryAttribute.name} ${sensoraccessory.accessoryAttribute.type} Thermostat`,
      );
      this.log.debug(
        'Registering new device: ',
        sensoraccessory.accessoryAttribute.name,
        ' ',
        sensoraccessory.accessoryAttribute.type,
        ' Thermostat - ',
        device.deviceID,
      );

      // create a new accessory
      const accessory = new this.api.platformAccessory(
        `${sensoraccessory.accessoryAttribute.name} ${sensoraccessory.accessoryAttribute.type} Thermostat`,
        uuid,
      );

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      accessory.context.firmwareRevision = sensoraccessory.accessoryAttribute.softwareRevision;

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new RoomSensorThermostat(this, accessory, locationId, device, sensoraccessory, group);
      this.log.debug(
        // eslint-disable-next-line max-len
        `Room Sensor Thermostat UDID: ${sensoraccessory.accessoryAttribute.name}-${sensoraccessory.accessoryAttribute.type}-${sensoraccessory.accessoryId}-RoomSensorThermostat-${device.deviceID}`,
      );

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  public unregisterPlatformAccessories(existingAccessory: PlatformAccessory) {
    // remove platform accessories when no longer present
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
  }

  public locationinfo(location: location) {
    if (this.config.devicediscovery) {
      if (location) {
        this.log.warn(JSON.stringify(location));
      }
    }
  }

  public deviceinfo(device: {
    deviceID: string;
    deviceType: string;
    deviceClass: string;
    deviceModel: string;
    priorityType: string;
    settings: Settings;
    inBuiltSensorState: inBuiltSensorState;
    groups: T9Thermostat['groups'];
  }) {
    if (this.config.devicediscovery) {
      this.log.warn(JSON.stringify(device));
      if (device.deviceID) {
        this.log.warn(JSON.stringify(device.deviceID));
        this.log.error(`Device ID: ${device.deviceID}`);
      }
      if (device.deviceType) {
        this.log.warn(JSON.stringify(device.deviceType));
        this.log.error(`Device Type: ${device.deviceType}`);
      }
      if (device.deviceClass) {
        this.log.warn(JSON.stringify(device.deviceClass));
        this.log.error(`Device Class: ${device.deviceClass}`);
      }
      if (device.deviceModel) {
        this.log.warn(JSON.stringify(device.deviceModel));
        this.log.error(`Device Model: ${device.deviceModel}`);
      }
      if (device.priorityType) {
        this.log.warn(JSON.stringify(device.priorityType));
        this.log.error(`Device Priority Type: ${device.priorityType}`);
      }
      if (device.settings) {
        this.log.warn(JSON.stringify(device.settings));
        if (device.settings.fan) {
          this.log.warn(JSON.stringify(device.settings.fan));
          this.log.error(`Device Fan Settings: ${device.settings.fan}`);
          if (device.settings.fan.allowedModes) {
            this.log.warn(JSON.stringify(device.settings.fan.allowedModes));
            this.log.error(`Device Fan Allowed Modes: ${device.settings.fan.allowedModes}`);
          }
          if (device.settings.fan.changeableValues) {
            this.log.warn(JSON.stringify(device.settings.fan.changeableValues));
            this.log.error(`Device Fan Changeable Values: ${device.settings.fan.changeableValues}`);
          }
        }
      }
      if (device.inBuiltSensorState) {
        this.log.warn(JSON.stringify(device.inBuiltSensorState));
        if (device.inBuiltSensorState.roomId) {
          this.log.warn(JSON.stringify(device.inBuiltSensorState.roomId));
          this.log.error(`Device Built In Sensor Room ID: ${device.inBuiltSensorState.roomId}`);
        }
        if (device.inBuiltSensorState.roomName) {
          this.log.warn(JSON.stringify(device.inBuiltSensorState.roomName));
          this.log.error(`Device Built In Sensor Room Name: ${device.inBuiltSensorState.roomName}`);
        }
      }
      if (device.groups) {
        this.log.warn(JSON.stringify(device.groups));

        for (const group of device.groups) {
          this.log.error(`Group: ${group.id}`);
        }
      }
    }
  }
}

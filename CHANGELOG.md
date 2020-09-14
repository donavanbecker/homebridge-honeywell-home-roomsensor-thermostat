# Changelog

All notable changes to this project will be documented in this file. This project uses [Semantic Versioning](https://semver.org/)

## [Version 2.0.0](https://github.com/donavanbecker/homebridge-honeywell-home-roomsensor-thermostat/compare/v1.0.0...v2.0.0) (2020-09-**)

### Major Changes

- Completely reworked the way that Thermostat and Sensors are discovered.
  - Reworked Room Priority. This is for T9 & T10 Thermostats Only.
    - This allows you to Display a Thermostat in the Room where your Room Sensors are and then set priority to that room.
- Completely reworked the way that Room Sensors discovered.

### Changes

- You can now set the Thermostat Setpoint Status to: NoHold, PermanentHold, or TemporaryHold.
- You can now set the Room Priority Type to: PickARoom, WholeHouse, or FollowMe.

## [Version 1.0.0](https://github.com/donavanbecker/homebridge-honeywell-home-roomsensor-thermostat/releases/tag/v1.0.0) (2020-09-02)

### Major Changes

- This plugin treats your T9 Thermostat's Roomsensor as a thermostat, so that you can set the room priority of that room.

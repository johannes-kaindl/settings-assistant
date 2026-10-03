# Profile demo

Lowers the round limit of the probe plugin. Used by the GUI smoke.

```settings-profile
{
  "version": 1,
  "plugins": {
    "sa-probe": {
      "maxRounds": 20
    }
  },
  "notes": {
    "plugins.sa-probe.maxRounds": "Fewer rounds finish faster."
  }
}
```

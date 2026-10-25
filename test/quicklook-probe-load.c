// Swift has no load-time initializer, so this starts test/quicklook-probe.swift when dyld injects the probe library.
void qlf_probe_start(void);

__attribute__((constructor)) static void load(void) {
  qlf_probe_start();
}

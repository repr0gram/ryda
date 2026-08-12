DEVICE ?= Ryda Test
BUNDLE  = com.fadi.ryda

.PHONY: help bootstrap generate test build run device devices shot clean

help:
	@echo "make bootstrap   install xcodegen + the iOS simulator runtime"
	@echo "make generate    regenerate Ryda.xcodeproj from project.yml"
	@echo "make test        RydaKit unit tests — macOS, no simulator, ~1s"
	@echo "make build       build for the simulator"
	@echo "make run         build, install and launch on the simulator"
	@echo "make device      build and install on a connected iPhone"
	@echo "make devices     list devices this Mac can see"
	@echo "make shot        screenshot the booted simulator"
	@echo ""
	@echo "DEVICE=\"iPhone 17\" make run   to target a different simulator"

bootstrap:
	command -v xcodegen >/dev/null || brew install xcodegen
	xcrun simctl list runtimes | grep -q iOS || xcodebuild -downloadPlatform iOS
	test -f Local.xcconfig || cp Local.xcconfig.example Local.xcconfig
	$(MAKE) generate

generate:
	xcodegen generate

test:
	swift test --package-path RydaKit

build: generate
	xcodebuild -project Ryda.xcodeproj -scheme Ryda \
	  -destination 'platform=iOS Simulator,name=$(DEVICE)' \
	  -derivedDataPath build build

run: build
	xcrun simctl boot "$(DEVICE)" 2>/dev/null || true
	open -a Simulator
	xcrun simctl install booted build/Build/Products/Debug-iphonesimulator/Ryda.app
	xcrun simctl launch booted $(BUNDLE)

# Builds for the phone that is actually connected, not "Any iOS Device".
#
# That distinction matters more than it looks: Apple issues a provisioning
# profile against registered devices, and a generic destination never tells
# Xcode which device to register — so it fails with "your team has no devices"
# however many phones are plugged in.
# Matched by shape rather than column, because the name column contains spaces
# ("Fadi's iPhone") and the state column varies — a phone with Developer Mode
# off reads "connected (no DDI)" rather than "available".
DEVICE_ID = $(shell xcrun devicectl list devices 2>/dev/null | \
  grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)

device: generate
	@test -n "$(DEVICE_ID)" || { \
	  echo "No device found. Connect your iPhone, unlock it, and make sure"; \
	  echo "Developer Mode is on: Settings > Privacy & Security > Developer Mode."; \
	  exit 1; }
	@echo "building for device $(DEVICE_ID)"
	xcodebuild -project Ryda.xcodeproj -scheme Ryda \
	  -destination 'platform=iOS,id=$(DEVICE_ID)' \
	  -derivedDataPath build-device \
	  -allowProvisioningUpdates build
	xcrun devicectl device install app --device $(DEVICE_ID) \
	  build-device/Build/Products/Debug-iphoneos/Ryda.app

# What the phone looks like from here — the first thing to check when a device
# build fails for a reason that is not the code.
devices:
	@xcrun devicectl list devices 2>/dev/null || echo "no devices"

shot:
	xcrun simctl io booted screenshot shot.png && echo "wrote ios/shot.png"

clean:
	rm -rf build build-device Ryda.xcodeproj

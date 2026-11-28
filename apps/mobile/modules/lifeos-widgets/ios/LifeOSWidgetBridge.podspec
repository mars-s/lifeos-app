Pod::Spec.new do |s|
  s.name           = 'LifeOSWidgetBridge'
  s.version        = '1.0.0'
  s.summary        = 'Writes the LifeOS widget snapshot and runs the Focus Live Activity'
  s.author         = ''
  s.homepage       = 'https://github.com/mars-s/lifeos-app'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_COMPILATION_MODE' => 'wholemodule' }
  s.source_files = '*.swift', 'Kit/*.swift'
end

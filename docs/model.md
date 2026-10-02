# Brake Lab 계산 모형

버전 `brake-1.0.0`. 일반 사용자가 구조와 제동 과정의 관계를 실험하는 교육용 모형이다. 임의의 일반화 형상을 사용하며 제조사 도면·사진·CAD를 포함하지 않는다. 실제 차량의 제동 성능, 정비 상태 또는 안전 여부를 판정하는 도구가 아니다.

## 계산 범위

한 바퀴에 배분한 차량 질량 `m`, 고정 수직하중 `Fz=m·9.81`, 바퀴 반경 `R`, 회전 관성 `I`를 사용한다. 직선·전진 제동만 다룬다. 하중 이동, 조향, 횡력, 노면 요철, 타이어 탄성·온도, 센서 추정 오차, 실제 제어기 보정과 유체 유량은 계산하지 않는다.

차량 속도 `v`와 바퀴 각속도 `ω`는 별도로 적분한다.

```
λ = (v − Rω) / max(v, 0.5 m/s)
F = μroad(λ) Fz
m dv/dt = −F
I dω/dt = RF − Tb
```

슬립은 내부적으로 −1..1에 제한한다. 음의 값도 허용하여 바퀴의 순간적인 과속 상태에서 힘의 방향을 올바르게 처리한다. 표시 슬립은 속도 0.5 m/s 미만에서 `null`이며, 화면은 “정지 근처”로 표시한다. 저속 분모는 수치적 정규화이며 그 구간에서 실제 노면 슬립을 측정한 값으로 해석하지 않는다.

## 디스크와 캘리퍼

패드 마찰 계수 `padFriction`은 노면 마찰 계수와 독립적이다. 압력 `P`는 Pa, 패드 평균 반경 `r`은 m이다.

```
토크 용량 = μpad · P · Aeffective · r
Floating 1피스톤: Aeffective = 2·πd²/4
Fixed 대향 피스톤: Aeffective = 모든 피스톤의 면적 합
```

`fixedPistonDiametersMm`는 **각 측에 동일하게 배치되는 지름 배열**이다. 배열 `[38.18,38.18]`이면 양쪽을 합쳐 4개이다. 양쪽 패드 수직력의 합을 `clampForce`, 각 측의 값을 `padNormalForce.inboard/outboard`로 제공한다.

바퀴가 멈췄을 때 필요한 노면 반작용 토크 `RF`가 용량 이하이면 실제 `brakeTorque=RF`이다. 용량 전체를 계속 적용하여 바퀴를 역방향으로 회전시키지 않는다. 용량을 넘는 노면 토크가 발생하면 바퀴는 다시 회전한다. 실제 피스톤 이동량·패드 변형·캘리퍼 이동량은 계산하지 않는다. 구조 관찰을 위한 확대 움직임은 계산 결과와 구분해 표시한다.

## 합성 노면과 이상적인 ABS

Magic Formula 형태를 사용한다.

```
μ(λ) = D sin(C atan(Bλ − E(Bλ − atan(Bλ))))
B=10, C=1.9, E=0.97
high: D=1, medium: D=0.6, low: D=0.2
```

세 곡선은 높은·중간·낮은 마찰의 **합성 연습 곡선**이다. 마른 도로·젖은 도로·빙판을 식별하거나 특정 타이어를 재현하지 않는다. 피크 슬립을 0..1에서 0.0001 간격으로 탐색한다. 현재 곡선들의 피크는 약 0.1802이며, 모든 차량·노면에 적용되는 보편적인 값이 아니다.

ABS는 실제 차량 속도를 정확히 안다고 가정한 이상적인 제어기이다. 5 ms 간격으로 목표 슬립의 기본 ±0.025 범위를 비교한다.

| 단계 | 압력 변화 | 입구 밸브 | 출구 밸브 |
|---|---|---|---|
| 증가 | `(운전자 명령 압력−P)/0.07 s` | 열림 | 닫힘 |
| 유지 | 0 | 닫힘 | 닫힘 |
| 감소 | `−P/0.035 s` | 닫힘 | 열림 |

`pumpActive`는 감소 단계의 환류 경로를 설명하는 표시이며 실제 유량 계산이 아니다. 2 m/s 미만에서 ABS 변조를 끝내고 운전자 압력으로 복귀한다. 이 기준과 시간 상수는 교육용 선택값이다. 조향 안정성은 계산하지 않는다. ABS의 정지거리가 항상 더 짧다는 주장은 하지 않는다. 약한 제동에서는 ABS가 개입하지 않아 같은 결과를 얻을 수 있다.

## 적분, 정지와 에너지

기본 물리 tick은 1 ms이며 화면 FPS와 분리한다. RK4를 사용하고 접촉 강성의 상한에 따라 tick을 2의 거듭제곱 개수로 나눈다. 바퀴 각속도의 0 통과 사건은 이분법으로 시간을 찾고, 남은 구간은 정지 마찰 조건으로 적분한다. 작은 수치 투영의 에너지도 `numericalProjectionEnergy`로 기록한다.

차량 속도 0.02 m/s 이하에서 실험을 정지한다. 이때 남는 차량·바퀴 운동에너지는 `cutoffResidualEnergy`로 따로 기록한다. 정지 후 `step()`은 상태를 유지한다. 정지 처리 이전의 이동거리와 시간이 결과이다. 기본 실험에서 정지 잔존 에너지는 약 0.074 J이며 초기 운동에너지는 약 150,698 J이다.

```
브레이크 열 = ∫ Tb ω dt
타이어 손실 = ∫ F(v−Rω) dt
energyResidual = 초기 운동에너지 − 현재 운동에너지
                 − 브레이크 열 − 타이어 손실 − 정지 잔존 에너지 − 수치 투영 에너지
```

디스크 평균 온도는 열용량 `디스크 질량·비열`, 브레이크 열의 배분 비율, 주변 공기와의 선형 냉각으로 계산한다. 기본 배분 비율은 0.9, 냉각 계수는 12 W/K이다. 디스크 내부의 온도 분포, 패드 페이드, 오일 비등과 균열을 예측하지 않는다. 타이어가 잠긴 경우 타이어에서 소모되는 에너지가 커지므로, ABS를 켠 실험에서 디스크 평균 온도가 더 높아질 수도 있다.

잠김 시간은 차량 속도 2 m/s 초과이며 바퀴 각속도가 0.1 rad/s 미만인 구간의 누적값이다. 실험의 정의를 고정하여 비교한다.

## API와 데이터

- `defaultSettings`, `ROAD_PRESETS`, `normalizeSettings(input)`을 내보낸다. 잘못된 타입·비유한 수치는 기본값으로 복원하고 유한 수치는 문서화된 범위로 제한한다. 배열은 복사한다.
- 주 설정 키는 `speedKmh`, `pressureBar`, `road`, `abs`, `caliper`, `padFriction`, `padMeanRadius`, `mass`, `initialTemperatureC`이다. 속도와 압력 입력은 km/h, bar이고 snapshot은 SI 단위이다. `discTemperatureC`만 섭씨이다.
- `createSimulation(settings)`는 `reset(settings)`, `step(dt)`, `snapshot()`, 읽기 전용 `settings`를 제공한다. `step`의 `dt`는 0..5초의 유한한 경과 시간이며 1 ms 미만의 잔여 시간은 다음 호출에 이월한다.
- `runExperiment(settings,{dt,duration})`는 불변 설정, `summary`, 첫 상태·마지막 상태를 포함한 최대 501개 불변 `samples`를 반환한다. 중간에는 10 ms마다 기록한 뒤 필요하면 균등 간격으로 줄인다. peak 온도와 누적량은 줄이기 전의 모든 계산 단계에서 구한다.
- 실험 `dt`는 1 ms를 더 작은 2의 거듭제곱으로 나누는 정밀도 요청이다. 실제 tick은 1/0.5/0.25/0.125 ms 중 선택하고 `summary.integrationStep`에 표시한다. 기본 duration은 60초, 허용 범위는 0..90초이다. 시간이 끝나도 정지하지 않으면 `stopped=false`, `stopDistance/stopTime=null`이다.
- `compareAbs(settings,options)`는 같은 설정에서 `abs`만 변경한 `withoutAbs`, `withAbs`, `difference`를 반환한다. 거리·시간 차이는 `켬−끔`이며 완료되지 않은 비교는 `null`이다. 이 함수가 제동력을 추가하거나 거리를 보정하지 않는다.
- `absEnabled`, `caliperType`, `pistonDiameter`, `fixedPistonDiameters`, `initialDiscTemperatureC`는 Scene 호환용으로 주 설정에서 파생하는 별칭이다. 상충하는 입력 별칭은 물리 계산에 사용하지 않는다.

모든 설정과 결과는 깊게 동결한다. 외부 입력 배열이나 이전 결과의 변경이 진행 중인 실험에 영향을 주지 않는다. 부품의 시각화 위치·카메라·확대 관찰 배율은 물리 상태에 영향을 주지 않는다.

## 1.1 상세 관측값

앱 1.1의 `brakeDetail(snapshot, settings)`는 이미 계산된 상태를 읽는 순수 함수다. `src/detail-model.js`에 있으며 `src/detail-readouts.js`에서도 다시 내보낸다. 원래 `brake-1.0.0` 적분식·기본값·제어·정지 기준을 변경하지 않는다. 입력 상태가 없거나 필요한 수치가 비유한 값이면 `null`을 반환한다. `describeBrakeDetail(partId, snapshot, settings)`는 최대 6개의 `{label,value,unit,digits}` 관측 항목과 해석 주의문 `note`를 반환한다. 수치는 표시 직전까지 숫자로 유지하며, 유효하지 않은 상태는 빈 목록과 상태 확인 문구로 처리한다.

### 힘·회전·동력

`caliper.hydraulicAreaPerSideM2`는 한쪽 피스톤 면적 합이다. 플로팅형 실제 피스톤 총 면적은 이 값이고, 대향 고정형 실제 총 면적은 두 배다. 두 구성 모두 양쪽 패드 수직력 합에 사용하는 `effectiveClampAreaM2`는 한쪽 면적 합의 두 배다. 실제 피스톤 수와 압착 유효 면적을 혼동하지 않는다. 기본 고정형과 플로팅형의 압착 유효 면적은 같으며 정상력·토크 용량도 같다. 관측값은 계산 설정의 치수를 사용한다. 장면의 대표 형상 범위로 치수를 제한했더라도 계산값을 그 범위로 바꾸지 않는다.

`rotor.meanSurfaceSpeedMps = padMeanRadius × wheelOmega`는 평균 접촉 반경에서의 로터 선속도이고 차량 속도가 아니다. `brakePowerW = brakeTorque × wheelOmega`는 **실제 제동 토크**로 구한다. 잠긴 바퀴는 압력과 토크 용량이 커도 로터 각속도가 0이므로 마찰 제동 동력은 0이다. 이때 차량이 움직이면 `wheel.tireLossPowerW = tireForce × (speed − wheelRadius × wheelOmega)`가 양수가 되어 에너지를 소모한다. 정지 토크 용량 전체를 순간 열 발생률로 잘못 사용하지 않는다.

`pads.actualTangentialForceN = brakeTorque / padMeanRadius`는 양쪽 패드를 합한 등가 접선력이고 개별 접촉점의 힘이 아니다. 패드 면적은 물리 입력에 없으므로 대표 형상을 이용한 접촉 압력·평균 면압·허용 응력을 만들지 않는다. `contactPressureSolved`는 `false`다.

### 디스크 평균 열수지

진행 중일 때 관측값은 다음과 같다. SI 수치는 W, J, K/s이며 표시할 때 kW, kJ, °C/s로 변환한다.

```
heatInputW = discHeatShare × brakePowerW
coolingPowerW = coolingWattsPerK × (discTemperatureC − ambientTemperatureC)
heatCapacityJPerK = discMass × discHeatCapacity
bulkTemperatureRateKPerS = (heatInputW − coolingPowerW) / heatCapacityJPerK
absorbedHeatJ = discHeatShare × brakeHeat
storedHeatJ = heatCapacityJPerK × (discTemperatureC − initialTemperatureC)
thermalClosureJ = storedHeatJ − absorbedHeatJ + discCoolingEnergy
```

주변으로의 열교환률은 부호가 있다. 디스크가 주변보다 차가우면 음수이며 주변에서 열을 받는다. `storedHeatJ` 역시 출발 온도 대비 변화량이어서 냉각 시 음수가 될 수 있다. `thermalClosureJ`는 기존 `thermalResidual`과 같다. `surfaceTemperatureSolved=false`는 마찰면 최고 온도·열점·열응력·페이드가 해석되지 않음을 명시한다.

**정지 완료 뒤에는 기존 `step()`이 전체 상태를 고정한다.** 따라서 새 관측값도 `coolingPowerW`, `bulkTemperatureRateKPerS`, `pressureRatePaPerS`를 0으로 표시한다. 주변보다 뜨거운 정지 디스크를 실제로 냉각시키는 후속 시간 해석이 추가된 것은 아니다. 누적 열·열교환 에너지와 마지막 평균 온도는 보존한다.

### ABS·센서·베어링

`hydraulics.pressureRatePaPerS`는 **현재 기록된 제어 단계**에서의 도함수다. 감소는 `−P/pressureDumpTime`, 유지는 0, 증가·ABS 끔·저속 복귀는 `(commandedPressure−P)/pressureFillTime`이다. 5 ms마다 다음 단계를 선택하므로 이 값은 다음 순간의 제어 전환을 예측하지 않는다. 슬립이 표시 불가인 0.5 m/s 미만에서는 `hydraulics.slip`과 `slipError`를 `null`로 유지한다. 목표 범위는 현재 합성 곡선의 피크 슬립 ± 설정 band다. 유량·펌프 RPM·펌프 소비 동력은 만들지 않으며 `flowSolved=false`다.

장면에 실제로 있는 대표 인코더 톱니는 48개다. `src/mechanical-detail.js`의 `ENCODER_TEETH`를 장면과 관측값이 공유하며 `encoder.pulseHz = 48 × |wheelOmega| / (2π)`다. 이는 톱니 통과 빈도이고 샘플링·신호 파형·잡음·측정 오차를 포함한 센서 출력은 아니다. 실제 ABS의 차량 속도 추정도 추가하지 않는다.

두 줄 허브 베어링은 장면의 대표 볼 중심 반경 R=0.0321 m와 볼 반경 r=0.0048 m를 사용한다. 외륜 고정, 접촉각 0°, 미끄럼 없는 운동을 가정한 `hubBearingKinematics`를 장면과 관측값이 공유한다. q=r/R일 때 케이지 속도는 내륜 속도의 `(1−q)/2`, 케이지에 대한 볼 자전 속도는 내륜 속도의 `−(1/q−q)/2`이고, 고정 좌표에서의 볼 자전은 두 속도의 합이다. 이는 기하적 운동 관계이며 실제 복열 각접촉 허브 베어링의 하중·예압·수명 계산이 아니다.

### 에너지 분배 표시와 검증

`energy`는 초기·현재 운동에너지, 누적 브레이크 열, 누적 타이어 손실, 정지 잔존 에너지와 수치 투영 에너지를 J로 제공한다. `accountedJ`는 현재 운동에너지와 네 소모·잔존 항목의 합이며 `initialJ − accountedJ = residualJ`다. **디스크 축적 열·냉각 에너지는 이미 브레이크 열 안의 배분이므로 전체 에너지 막대에 다시 더하지 않는다.** 초기 운동에너지가 0인 경우에는 분율을 만들기 위해 0으로 나누지 않는다.

`tests/detail-model.test.mjs`는 독립적인 피스톤 면적과 힘·토크 복원, 기본 두 캘리퍼의 동등성, 압력의 해석적 지수 변화, 무제동 냉각의 해석해, 잠김 상태의 0 마찰 동력, 기계·열수지, 정지/저속 구분, 인코더 빈도와 양쪽 베어링 접촉 속도, 표시 단위·비변경성을 검증한다. 압력 적분과 해석해의 비교 오차는 RK4의 5차 나머지 상한을 사용한다.

## 참고한 공식 자료

- [MathWorks Disc Brake](https://www.mathworks.com/help/sdl/ref/discbrake.html): 압력·피스톤 면적·패드 평균 반경과 토크, 정지 마찰 반작용의 개념.
- [MathWorks ABS 예제](https://www.mathworks.com/help/simulink/slref/modeling-an-anti-lock-braking-system.html): 단일 바퀴 차량/회전 동역학, 이상적인 슬립 피드백의 한계.
- [MathWorks Magic Formula](https://www.mathworks.com/help/sdl/ref/tireroadinteractionmagicformula.html): 종방향 마찰 곡선 형태와 계수의 의미.
- [Bosch ABS](https://www.bosch-mobility.com/en/solutions/driving-safety/antilock-braking-system/): 휠 속도 센서, 유압 조절 밸브와 환류 펌프의 구성 개념.

공식 자료는 개념 검증에 사용했다. 본 앱의 기본값·합성 곡선·제어 시간 상수·정지 처리·형상은 자체적인 교육용 설계이다.

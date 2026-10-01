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

## 참고한 공식 자료

- [MathWorks Disc Brake](https://www.mathworks.com/help/sdl/ref/discbrake.html): 압력·피스톤 면적·패드 평균 반경과 토크, 정지 마찰 반작용의 개념.
- [MathWorks ABS 예제](https://www.mathworks.com/help/simulink/slref/modeling-an-anti-lock-braking-system.html): 단일 바퀴 차량/회전 동역학, 이상적인 슬립 피드백의 한계.
- [MathWorks Magic Formula](https://www.mathworks.com/help/sdl/ref/tireroadinteractionmagicformula.html): 종방향 마찰 곡선 형태와 계수의 의미.
- [Bosch ABS](https://www.bosch-mobility.com/en/solutions/driving-safety/antilock-braking-system/): 휠 속도 센서, 유압 조절 밸브와 환류 펌프의 구성 개념.

공식 자료는 개념 검증에 사용했다. 본 앱의 기본값·합성 곡선·제어 시간 상수·정지 처리·형상은 자체적인 교육용 설계이다.

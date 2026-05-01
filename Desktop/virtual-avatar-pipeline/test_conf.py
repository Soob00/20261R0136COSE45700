from pipeline.feature_extractor import extract_features

img = "samples/01_original.png"

for conf in [0.5, 0.4, 0.3, 0.2, 0.1]:
    fv = extract_features(img, min_confidence=conf)
    print("conf", conf, "=>", "success" if fv else "failed")
    if fv:
        print(fv.to_dict())

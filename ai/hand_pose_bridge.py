"""
Hand position derivation from YOLOv8-pose keypoints.
This is a robust fallback when MediaPipe HandLandmarker fails to load.

COCO pose keypoints we use:
- 5/6: left/right shoulder
- 7/8: left/right elbow
- 9/10: left/right wrist
- 11/12: left/right hip
"""
import sys
import os

KP_LEFT_SHOULDER = 5
KP_RIGHT_SHOULDER = 6
KP_LEFT_ELBOW = 7
KP_RIGHT_ELBOW = 8
KP_LEFT_WRIST = 9
KP_RIGHT_WRIST = 10
KP_LEFT_HIP = 11
KP_RIGHT_HIP = 12


def _classify_wrist_position(wrist_xy, shoulder_y, hip_y, body_left, body_right, body_top, body_bottom):
    """Classify a wrist position based on body geometry."""
    if not wrist_xy:
        return 'unknown'
    wx, wy = wrist_xy
    body_h = max(body_bottom - body_top, 1)
    body_w = max(body_right - body_left, 1)
    rel_y = (wy - body_top) / body_h
    rel_x = (wx - body_left) / body_w

    # Hand above head (high above shoulders)
    if wy < shoulder_y - 20:
        if rel_x > 0.35 and rel_x < 0.65:
            return 'hand_raised'
        return 'hand_high'

    # Hand near face
    if rel_y < 0.25:
        return 'hand_to_face'

    # Hand near pocket (lower 40-80% of body, on the side, not in middle)
    if 0.40 < rel_y < 0.85 and (rel_x < 0.30 or rel_x > 0.70):
        return 'reaching_pocket'

    # Hand at chest/torso middle
    if 0.30 < rel_x < 0.70 and 0.25 < rel_y < 0.55:
        return 'at_body'

    # Hand extended outward (side, mid)
    if (rel_x < 0.25 or rel_x > 0.75) and 0.20 < rel_y < 0.55:
        return 'reaching_object'

    return 'visible'


def derive_hands_from_pose(pose_data):
    """
    Given list of pose detections (each with bbox and 17 keypoints),
    return list of {bbox, gesture, hand, center, wrist, finger_count}.
    """
    out = []
    for p in pose_data:
        try:
            kpts = p.get('keypoints')
            confs = p.get('keypoint_conf')
            bbox = p.get('bbox')
            if not kpts or not confs or not bbox:
                continue
            bx1, by1, bx2, by2 = bbox
            body_left, body_top, body_right, body_bottom = bx1, by1, bx2, by2

            l_shoulder_y = kpts[KP_LEFT_SHOULDER][1] if confs[KP_LEFT_SHOULDER] > 0.3 else None
            r_shoulder_y = kpts[KP_RIGHT_SHOULDER][1] if confs[KP_RIGHT_SHOULDER] > 0.3 else None
            l_hip_y = kpts[KP_LEFT_HIP][1] if confs[KP_LEFT_HIP] > 0.3 else None
            r_hip_y = kpts[KP_RIGHT_HIP][1] if confs[KP_RIGHT_HIP] > 0.3 else None
            shoulder_y = None
            hip_y = None
            sh_vals = [v for v in (l_shoulder_y, r_shoulder_y) if v is not None]
            if sh_vals:
                shoulder_y = sum(sh_vals) / len(sh_vals)
            hip_vals = [v for v in (l_hip_y, r_hip_y) if v is not None]
            if hip_vals:
                hip_y = sum(hip_vals) / len(hip_vals)

            # Process each wrist
            for wrist_idx, hand_name in ((KP_LEFT_WRIST, 'left'), (KP_RIGHT_WRIST, 'right')):
                if confs[wrist_idx] < 0.3:
                    continue
                wrist_xy = kpts[wrist_idx]
                wx, wy = wrist_xy

                # Build a small bbox around the wrist (estimate 50x50)
                wx1, wy1 = wx - 25, wy - 25
                wx2, wy2 = wx + 25, wy + 25
                gesture = _classify_wrist_position(
                    wrist_xy, shoulder_y, hip_y,
                    body_left, body_right, body_top, body_bottom
                )
                out.append({
                    'bbox': [wx1, wy1, wx2, wy2],
                    'gesture': gesture,
                    'hand': hand_name,
                    'center': [wx, wy],
                    'wrist': [wx, wy],
                    'finger_count': None,  # not available from pose
                    'source': 'pose'
                })
        except Exception as e:
            continue
    return out


if __name__ == '__main__':
    # Self-test with fake data
    fake_pose = [{
        'bbox': [100, 50, 300, 500],
        'keypoints': [
            [200, 60],  # 0 nose
            [190, 55], [210, 55], [185, 58], [215, 58],  # 1-4
            [170, 100], [230, 100],  # 5, 6 shoulders
            [150, 200], [250, 200],  # 7, 8 elbows
            [130, 250], [270, 350],  # 9, 10 wrists (left near hip, right below)
            [180, 300], [220, 300],  # 11, 12 hips
            [180, 400], [220, 400],  # 13, 14 knees
            [180, 500], [220, 500],  # 15, 16 ankles
        ],
        'keypoint_conf': [0.9] * 17
    }]
    hands = derive_hands_from_pose(fake_pose)
    print(f"Detected {len(hands)} hands from fake pose:")
    for h in hands:
        print(f"  {h['hand']}: {h['gesture']} at ({h['center'][0]:.0f}, {h['center'][1]:.0f})")

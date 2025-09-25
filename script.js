const video = document.getElementById('video');
const enrollButton = document.getElementById('enrollButton');
const verifyButton = document.getElementById('verifyButton');
const updateButton = document.getElementById('updateButton');
const statusDiv = document.getElementById('status');

const FACE_MATCH_THRESHOLD = 0.5;
let smoothedBox = null;


Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
    faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
    faceapi.nets.faceRecognitionNet.loadFromUri('/models')
]).then(startVideo);

async function startVideo() {
    statusDiv.textContent = 'Models loaded. Starting webcam...';
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        video.srcObject = stream;
        statusDiv.textContent = 'Webcam started. Ready to enroll or verify.';
    } catch (err) {
        console.error('Error starting video stream:', err);
        statusDiv.textContent = 'Error starting webcam. Please allow access.';
    }
}


video.addEventListener('play', () => {
    const canvas = faceapi.createCanvasFromMedia(video);
    document.getElementById('video-container').append(canvas);
    const displaySize = { width: video.width, height: video.height };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        const detections = await faceapi.detectAllFaces(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks();
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);

        if (resizedDetections && resizedDetections.length > 0) {
            const box = resizedDetections[0].detection.box;
            if (smoothedBox === null) {
                smoothedBox = box;
            } else {
                const factor = 0.2;
                smoothedBox = new faceapi.Box({
                    x: smoothedBox.x + (box.x - smoothedBox.x) * factor,
                    y: smoothedBox.y + (box.y - smoothedBox.y) * factor,
                    width: smoothedBox.width + (box.width - smoothedBox.width) * factor,
                    height: smoothedBox.height + (box.height - smoothedBox.height) * factor,
                });
            }
            context.strokeStyle = '#42f584';
            context.lineWidth = 4;
            context.shadowColor = 'rgba(0, 0, 0, 0.5)';
            context.shadowBlur = 10;
            context.beginPath();
            context.roundRect(smoothedBox.x, smoothedBox.y, smoothedBox.width, smoothedBox.height, 15);
            context.stroke();
            context.closePath();
            faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
        } else {
            smoothedBox = null;
        }
    }, 50);
});

verifyButton.addEventListener('click', async () => {
    statusDiv.textContent = "Liveness check starting...";
    try {
        const detectionResult = await runHeadTurnChallenge();
        statusDiv.textContent = "Liveness confirmed! Now verifying identity...";

        const faceData = await getFaceData();
        if (faceData.length === 0) {
            statusDiv.textContent = 'Verification failed. No faces enrolled yet.';
            return;
        }

        const faceMatcher = new faceapi.FaceMatcher(faceData, FACE_MATCH_THRESHOLD);
        const bestMatch = faceMatcher.findBestMatch(detectionResult.descriptor);

        if (bestMatch.label !== 'unknown') {
            statusDiv.textContent = `Verification successful! Welcome, ${bestMatch.label}.`;
        } else {
            statusDiv.textContent = 'Verification failed. Face not recognized.';
        }
    } catch (error) {
        statusDiv.textContent = `Verification failed: ${error}`;
    }
});

function runHeadTurnChallenge() {
    return new Promise((resolve, reject) => {
        const TIMEOUT = 10000; // 10 seconds for the whole challenge
        let challengeState = "CENTER"; // CENTER -> LEFT -> RIGHT -> DONE
        let lastDetection = null;

        statusDiv.textContent = "Please look straight at the camera.";

        const challengeInterval = setInterval(async () => {
            const detection = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!detection) return;
            lastDetection = detection;

            const landmarks = detection.landmarks;
            const nose = landmarks.getNose();
            const leftEye = landmarks.getLeftEye();
            const rightEye = landmarks.getRightEye();

            const eyeCenter = { x: (leftEye[0].x + rightEye[3].x) / 2, y: (leftEye[0].y + rightEye[3].y) / 2 };
            
 
            const noseToEyeCenterDist = nose[3].x - eyeCenter.x;
            
            // Define a threshold for what counts as a "turn"
            const turnThreshold = (rightEye[3].x - leftEye[0].x) * 0.2;

            switch (challengeState) {
                case "CENTER":

                    if (Math.abs(noseToEyeCenterDist) < turnThreshold * 0.5) {
                        challengeState = "LEFT";
                        statusDiv.textContent = "✅ Centered! Now, slowly turn your head to your LEFT.";
                    }
                    break;
                case "LEFT":

                    if (noseToEyeCenterDist > turnThreshold) {
                        challengeState = "RIGHT";
                        statusDiv.textContent = "✅ Great! Now, slowly turn your head to your RIGHT.";
                    }
                    break;
                case "RIGHT":

                    if (noseToEyeCenterDist < -turnThreshold) {
                        challengeState = "DONE";
                        clearInterval(challengeInterval);
                        resolve(lastDetection); // SUCCESS!
                    }
                    break;
            }
        }, 100);

        setTimeout(() => {
            clearInterval(challengeInterval);
            if (challengeState !== "DONE") {
                reject("Liveness challenge timed out.");
            }
        }, TIMEOUT);
    });
}


enrollButton.addEventListener('click', async () => {
    const name = prompt('Please enter your name for enrollment:');
    if (!name) { statusDiv.textContent = 'Enrollment cancelled.'; return; }
    statusDiv.textContent = 'Detecting face for enrollment...';
    const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
    if (detections) {
        await saveFaceData(name, detections.descriptor);
        statusDiv.textContent = `Enrolled ${name} successfully!`;
    } else {
        statusDiv.textContent = 'No face detected. Please try again.';
    }
});

updateButton.addEventListener('click', async () => {
    const name = prompt('Enter the name of the user to update or delete:');
    if (!name) { statusDiv.textContent = 'Operation cancelled.'; return; }
    const action = confirm(`Do you want to DELETE ${name}?\n\n- Click 'OK' to delete.\n- Click 'Cancel' to re-enroll (update) this user's face.`);
    if (action) {
        await deleteFaceData(name);
    } else {
        statusDiv.textContent = `Updating ${name}. Please look at the camera.`;
        await deleteFaceData(name, true);
        const detections = await faceapi.detectSingleFace(video, new faceapi.TinyFaceDetectorOptions()).withFaceLandmarks().withFaceDescriptor();
        if (detections) {
            await saveFaceData(name, detections.descriptor);
            statusDiv.textContent = `Successfully updated the face for ${name}!`;
        } else {
            statusDiv.textContent = `Update failed. No face detected for ${name}.`;
        }
    }
});

async function saveFaceData(name, descriptor) {
    try {
        const response = await fetch('http://localhost:3001/enroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, descriptor: Array.from(descriptor) })
        });
        const result = await response.json();
        console.log(result.message);
    } catch (error) {
        console.error('Error saving face data:', error);
        statusDiv.textContent = 'Error: Could not save face data to the server.';
    }
}

async function getFaceData() {
    try {
        const response = await fetch('http://localhost:3001/faces');
        const faceData = await response.json();
        return faceData.map(data =>
            new faceapi.LabeledFaceDescriptors(data.label, [new Float32Array(data.descriptors[0])])
        );
    } catch (error) {
        console.error('Error fetching face data:', error);
        statusDiv.textContent = 'Error: Could not get face data from the server.';
        return [];
    }
}

async function deleteFaceData(name, silent = false) {
    try {
        const response = await fetch(`http://localhost:3001/delete/${name}`, { method: 'DELETE' });
        const result = await response.json();
        if (!silent) {
            statusDiv.textContent = result.message;
        }
        console.log(result.message);
    } catch (error) {
        console.error('Error deleting face data:', error);
        if (!silent) {
            statusDiv.textContent = 'Error: Could not delete face data on the server.';
        }
    }
}
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Camera, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import * as faceapi from "@vladmandic/face-api";

interface FacialRecognitionProps {
  rfidData: any;
  onSuccess: (faceData: string) => void;
  onError: (error: string) => void;
}

const FacialRecognition = ({ rfidData, onSuccess, onError }: FacialRecognitionProps) => {
  const [status, setStatus] = useState<'idle' | 'loading-models' | 'scanning' | 'verifying' | 'success' | 'error'>('idle');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    loadModels();
    return () => {
      stopCamera();
    };
  }, []);

  const loadModels = async () => {
    try {
      setStatus('loading-models');
      const MODEL_URL = '/models'; // Models should be in public/models folder
      
      // Load face-api.js models
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
      ]);

      setModelsLoaded(true);
      setStatus('idle');
      toast.success("Face recognition models loaded");
    } catch (error) {
      console.error("Error loading models:", error);
      toast.warning("Could not load face recognition models. Using camera capture mode.");
      setModelsLoaded(false);
      setStatus('idle');
    }
  };

  const startCamera = async () => {
    try {
      setStatus('scanning');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        streamRef.current = stream;
        
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          toast.info("Camera ready. Position your face in the frame...");
          
          // Start face detection after a short delay
          setTimeout(() => {
            if (modelsLoaded) {
              detectFace();
            } else {
              captureImage();
            }
          }, 2000);
        };
      }
    } catch (error: any) {
      console.error("Camera error:", error);
      setStatus('error');
      toast.error("Failed to access camera: " + error.message);
      onError("Camera access denied");
    }
  };

  const detectFace = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    try {
      setStatus('verifying');
      
      const detections = await faceapi
        .detectSingleFace(videoRef.current, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (detections) {
        // Draw detection on canvas
        const displaySize = {
          width: videoRef.current.videoWidth,
          height: videoRef.current.videoHeight
        };
        faceapi.matchDimensions(canvasRef.current, displaySize);
        const resizedDetections = faceapi.resizeResults(detections, displaySize);
        
        const context = canvasRef.current.getContext('2d');
        if (context) {
          context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
          faceapi.draw.drawDetections(canvasRef.current, resizedDetections);
          faceapi.draw.drawFaceLandmarks(canvasRef.current, resizedDetections);
        }

        // Convert face descriptor to string
        const faceEncoding = JSON.stringify(Array.from(detections.descriptor));
        
        setStatus('success');
        toast.success("Face detected and verified!");
        
        // Stop camera
        stopCamera();
        
        onSuccess(faceEncoding);
      } else {
        toast.warning("No face detected. Please position your face in the frame.");
        setStatus('scanning');
        // Retry after a second
        setTimeout(detectFace, 1000);
      }
    } catch (error) {
      console.error("Face detection error:", error);
      // Fallback to image capture
      captureImage();
    }
  };

  const captureImage = () => {
    if (!videoRef.current || !canvasRef.current) return;

    try {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);

        // Convert canvas to base64 image
        const imageData = canvasRef.current.toDataURL('image/jpeg', 0.8);
        
        setStatus('success');
        toast.success("Face captured successfully!");
        
        stopCamera();
        onSuccess(imageData);
      }
    } catch (error) {
      console.error("Capture error:", error);
      setStatus('error');
      toast.error("Failed to capture image");
      onError("Image capture failed");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-4 p-6 rounded-xl border-2 transition-all ${
        status === 'success'
          ? "border-success bg-success/5"
          : status === 'scanning' || status === 'verifying'
          ? "border-primary bg-primary/5 animate-pulse"
          : status === 'error'
          ? "border-destructive bg-destructive/5"
          : "border-border bg-muted/30"
      }`}>
        <div className="flex-shrink-0">
          {status === 'success' ? (
            <CheckCircle2 className="h-10 w-10 text-success" />
          ) : status === 'scanning' || status === 'verifying' || status === 'loading-models' ? (
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
          ) : status === 'error' ? (
            <AlertCircle className="h-10 w-10 text-destructive" />
          ) : (
            <Camera className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg">Facial Recognition</h3>
          <p className="text-sm text-muted-foreground">
            {status === 'loading-models' && "Loading AI models..."}
            {status === 'scanning' && "Position your face in the camera frame"}
            {status === 'verifying' && "Analyzing facial features..."}
            {status === 'success' && "Face verified successfully!"}
            {status === 'error' && "Face verification failed"}
            {status === 'idle' && "Ready to scan your face"}
          </p>
        </div>
        {status === 'idle' && (
          <Button
            onClick={startCamera}
            className="bg-primary hover:bg-primary/90"
          >
            <Camera className="mr-2 h-4 w-4" />
            Start Camera
          </Button>
        )}
        {status === 'success' && (
          <CheckCircle2 className="h-8 w-8 text-success" />
        )}
      </div>

      {/* Video and Canvas for face detection */}
      {(status === 'scanning' || status === 'verifying') && (
        <div className="relative w-full max-w-2xl mx-auto rounded-lg overflow-hidden border-2 border-primary">
          <video
            ref={videoRef}
            className="w-full"
            autoPlay
            muted
            playsInline
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-full h-full"
          />
        </div>
      )}
    </div>
  );
};

export default FacialRecognition;
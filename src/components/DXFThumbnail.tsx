import React, { useState, useEffect, useMemo } from 'react';
import { loadOutline } from '../utils/outline/outlineCache';

interface DXFThumbnailProps {
    url: string;
    alt: string;
    className?: string;
    strokeColor?: string;
}

const DXFThumbnail: React.FC<DXFThumbnailProps> = ({ url, alt, className, strokeColor = '#22c55e' }) => {
    const [pathData, setPathData] = useState<string | null>(null);
    const [viewBox, setViewBox] = useState<string>("0 0 100 100");
    const [error, setError] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let mounted = true;
        
        const loadDxf = async () => {
            try {
                setLoading(true);
                const outline = await loadOutline(url);
                if (!mounted) return;
                setViewBox(outline.viewBox);
                setPathData(outline.pathData);
            } catch (err) {
                console.error("Error loading DXF thumbnail:", err);
                if (mounted) setError(true);
            } finally {
                if (mounted) setLoading(false);
            }
        };

        loadDxf();

        return () => {
            mounted = false;
        };
    }, [url]);

    if (error) {
        return (
            <div className={`flex items-center justify-center bg-gray-900 text-gray-500 text-xs ${className}`}>
                Failed
            </div>
        );
    }

    if (loading) {
         return (
            <div className={`flex items-center justify-center bg-gray-900 ${className}`}>
                 <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className={`flex items-center justify-center ${className}`}>
             <svg viewBox={viewBox} className="w-full h-full" style={{ stroke: strokeColor, fill: 'none', strokeWidth: '1px', vectorEffect: 'non-scaling-stroke' }}>
                <path d={pathData || ''} transform="scale(1, -1)" />
            </svg>
        </div>
    );
};

export default DXFThumbnail;

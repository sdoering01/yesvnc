const debugging = 1;

const urlParams = new URLSearchParams(window.location.search);
const host = urlParams.get('host') || window.location.host;
const path = urlParams.get('path') || '/';
const channel = urlParams.get('channel');
if (channel) {
    const roomIndicator = document.getElementById('room-indicator');
    roomIndicator.innerText = `Channel ${channel}`;
    roomIndicator.classList.remove('hidden');
}
const secure = urlParams.get('secure') !== 'false';

if (debugging) {
    console.log('host', host);
    console.log('path', path);
    console.log('channel', channel);
    console.log('secure', secure);
}

const combine_rects_x_min_distance = 24;
const combine_rects_y_min_distance = 4;

const scroll_detection_x_min = -64;
const scroll_detection_x_max = 64;
const scroll_detection_y_min = -64;
const scroll_detection_y_max = 64;
const scroll_detection_r_max = 16;
const scroll_detection_min_width = 256;
const scroll_detection_min_height = 256;
const scroll_detection_min_stripe_width = 16;
const scroll_detection_min_stripe_height = 16;
const scroll_detection_point_divisor = 1024;
const scroll_detection_length_divisor = 8;
const scroll_detection_same_color_threshold = 0.995;
const scroll_detection_hit_threshold = 0.995;

let video = document.getElementById('video');
const canvas0 = document.getElementById('canvas0');
const canvas1 = document.getElementById('canvas1');
let ctx0 = undefined;
let ctx1 = undefined;

function hideElement(el) {
    el.classList.add('hidden');
}

function showElement(el) {
    el.classList.remove('hidden');
}

const displayMediaOptions = { video: { cursor: 'always' }, audio: false };

async function startCapture() {
    video.srcObject = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    showElement(document.getElementById('preview-section'));
}

function stopCapture(evt) {
    hideElement(document.getElementById('preview-section'));
    let tracks = video.srcObject.getTracks();
    tracks.forEach(function (track) {
        track.stop();
    });
    video.srcObject = null;
}

const startButton = document.getElementById('start');
const stopButton = document.getElementById('stop');

startButton.addEventListener(
    'click',
    function (evt) {
        startCapture();
        startButton.setAttribute('disabled', '');
        stopButton.removeAttribute('disabled');
    },
    false
);

stopButton.addEventListener(
    'click',
    function (evt) {
        stopCapture();
        start.removeAttribute('disabled');
        stopButton.setAttribute('disabled', '');
        window.location.reload();
    },
    false
);

let socket = undefined;

function buf2hex(buffer) {
    const b = new Uint8Array(buffer);
    const hexdump = Array.prototype.map
        .call(b, function (x) {
            return ('00' + x.toString(16)).slice(-2);
        })
        .join(' ');
    return (
        hexdump +
        ' (' +
        buffer.byteLength.toString() +
        (buffer.byteLength == 1 ? ' byte)' : ' bytes)')
    );
}

let wScreen = 0;
let hScreen = 0;

const rfb_padding = 0;
const rfb_encoding_raw = 0;
const rfb_encoding_copyrect = 1;
const rfb_encoding_rre = 2;
const rfb_encoding_tight = 7;
const rfb_name = 'wc:6';
const rfb_name_length = rfb_name.length;

class Rect {
    constructor(x, y, w, h, encoding) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.encoding = encoding;
    }

    send() {
        const buffer = new ArrayBuffer(12);
        const b = new Uint8Array(buffer);
        b[0] = this.x >>> 8;
        b[1] = this.x & 0xff;
        b[2] = this.y >>> 8;
        b[3] = this.y & 0xff;
        b[4] = this.w >>> 8;
        b[5] = this.w & 0xff;
        b[6] = this.h >>> 8;
        b[7] = this.h & 0xff;
        b[8] = this.encoding >>> 24;
        b[9] = (this.encoding >>> 16) & 0xff;
        b[10] = (this.encoding >>> 8) & 0xff;
        b[11] = this.encoding & 0xff;
        if (debugging) console.log('sending Rect object: ' + buf2hex(buffer));
        socket.send(buffer);
    }
}

class RawRect extends Rect {
    constructor(x, y, w, h, data) {
        super(x, y, w, h, rfb_encoding_raw);
        this.data = data;
    }

    send() {
        super.send();
        if (debugging)
            console.log(
                'sending RawRect object data (' + this.data.byteLength.toString() + ' pixel bytes)'
            );
        socket.send(this.data);
    }
}

class ScrollRect extends Rect {
    constructor(x, y, w, h, dx, dy) {
        super(x, y, w, h, rfb_encoding_copyrect);
        this.dx = dx;
        this.dy = dy;
    }

    send() {
        super.send();
        const buffer = new ArrayBuffer(4);
        const b = new Uint8Array(buffer);
        b[0] = this.dx >>> 8;
        b[1] = this.dx & 0xff;
        b[2] = this.dy >>> 8;
        b[3] = this.dy & 0xff;
        if (debugging) console.log('sending ScrollRect object: ' + buf2hex(buffer));
        socket.send(buffer);
    }
}

class SolidRect extends Rect {
    constructor(x, y, w, h, color) {
        super(x, y, w, h, rfb_encoding_rre);
        this.color = color;
    }

    send() {
        super.send();
        const buffer = new ArrayBuffer(8);
        const b = new Uint8Array(buffer);
        b[0] = 0; // number of sub-rectangles
        b[1] = 0;
        b[2] = 0;
        b[3] = 0;
        b[4] = this.color >>> 16;
        b[5] = (this.color >>> 8) & 0xff;
        b[6] = this.color & 0xff;
        b[7] = rfb_padding;
        if (debugging) console.log('sending SolidRect object: ' + buf2hex(buffer));
        socket.send(buffer);
    }
}

class TightRect extends Rect {
    constructor(x, y, w, h, data) {
        super(x, y, w, h, rfb_encoding_tight);
        this.data = data;
    }

    send() {
        super.send();
        const data_length = this.data.byteLength;
        let data_length_length = undefined;
        if (data_length <= 0x7f) data_length_length = 1;
        else if (data_length <= 0x3fff) data_length_length = 2;
        else data_length_length = 3;
        const buffer = new ArrayBuffer(1 + data_length_length);
        const b = new Uint8Array(buffer);
        b[0] = 0x90; // Tight-JPEG
        if (data_length <= 0x7f) b[1] = data_length & 0x7f;
        else if (data_length <= 0x3fff) {
            b[1] = (data_length & 0x7f) | 0x80;
            b[2] = (data_length & 0x3f80) >>> 7;
        } else {
            b[1] = (data_length & 0x7f) | 0x80;
            b[2] = ((data_length & 0x3f80) >>> 7) | 0x80;
            b[3] = (data_length & 0x3fc000) >>> 14;
        }
        if (debugging) console.log('sending TightRect object header: ' + buf2hex(buffer));
        socket.send(buffer);
        if (debugging)
            console.log(
                'sending TightRect object data (' + data_length.toString() + ' pixel bytes)'
            );
        socket.send(this.data);
    }
}

let rects = new Array();

class ScrollParams {
    constructor(x, y, w, h, dx, dy) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        this.dx = dx;
        this.dy = dy;
    }
}

let scrollRects = new Array();

let rfb_bits_per_pixel = 32;
let rfb_depth = 24;
let rfb_big_endian_flag = 0;
let rfb_true_color_flag = 1;
let rfb_red_maximum = 255;
let rfb_green_maximum = 255;
let rfb_blue_maximum = 255;
let rfb_red_shift = 24;
let rfb_green_shift = 16;
let rfb_blue_shift = 8;

let isFirstFrame = 1;
let processing = 0;
const rfb_aborted = 42;

function fillRectBuffer(px, x, y, w, h, color) {
    for (let yy = 0; yy < h; yy++) {
        let o = (y + yy) * wScreen + x;
        for (let xx = 0; xx < w; xx++) px[o++] = color;
    }
}

function scrollRectBuffer(px, x, y, w, h, dx, dy) {
    const ww = w - Math.abs(dx);
    const hh = h - Math.abs(dy);
    const do0 = dy > 0 ? -wScreen : wScreen;
    let o10 = (dy > 0 ? y + h - 1 : y) * wScreen + (dx > 0 ? x + w - 1 : x);
    let o00 = ((dy > 0 ? y + h - 1 : y) - dy) * wScreen + (dx > 0 ? x + w - 1 : x) - dx;
    for (let i = 0; i < hh; i++) {
        o1 = o10;
        o0 = o00;
        if (dx > 0) for (let j = 0; j < ww; j++) px[o1--] = px[o0--];
        else for (let j = 0; j < ww; j++) px[o1++] = px[o0++];
        o10 += do0;
        o00 += do0;
    }
}

function sleep(delay) {
    return new Promise(function (resolve) {
        setTimeout(resolve, delay);
    });
}

function canvasToBlob(canvas, type, options) {
    return new Promise(function (resolve) {
        canvas.toBlob(resolve, type, options);
    });
}

function pushRectRaw(x, y, w, h) {
    const data_length = w * h * 4;
    const buffer = new ArrayBuffer(data_length);
    const b = new Uint8Array(buffer);
    const id1 = ctx1.getImageData(x, y, w, h);
    const px1 = new Uint8Array(id1.data.buffer);
    let bo = 0;
    let po = 0;
    for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++) {
            b[bo + 0] = px1[po + 2];
            b[bo + 1] = px1[po + 1];
            b[bo + 2] = px1[po + 0];
            b[bo + 3] = rfb_padding;
            bo += 4;
            po += 4;
        }
    if (debugging) console.log('storing RawRect (' + data_length.toString() + ' pixel bytes)');
    rects.push(new RawRect(x, y, w, h, buffer));
}

function pushRectScroll(x, y, w, h, dx, dy) {
    if (debugging) console.log('storing ScrollRect');
    rects.push(new ScrollRect(x, y, w, h, dx, dy));
}

function pushRectSolid(x, y, w, h, color) {
    if (debugging) console.log('storing SolidRect');
    rects.push(new SolidRect(x, y, w, h, color));
}

async function pushRectTight(x, y, w, h) {
    if (debugging)
        console.log(
            'pushRectTight: x = ' +
                x.toString() +
                ', y = ' +
                y.toString() +
                ', w = ' +
                w.toString() +
                ', h = ' +
                h.toString()
        );
    let canvas = undefined;
    if (x == 0 && y == 0 && w == wScreen && h == hScreen) canvas = canvas1;
    else {
        canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(canvas1, -x, -y);
    }
    // if (debugging)
    //   console.log ("calling canvasToBlob()");
    const blob = await canvasToBlob(canvas, 'image/jpeg');
    // if (debugging)
    //   console.log ("calling blob.arrayBuffer()");
    const jpeg_buffer = await blob.arrayBuffer();
    // if (debugging)
    //   console.log ("storing TightRect (" + jpeg_buffer.byteLength.toString () + " instead of " + (w * h * 4).toString () + " pixel bytes)");
    rects.push(new TightRect(x, y, w, h, jpeg_buffer));
}

function detectScrolling(px0, px1, x, y, w, h) {
    if (debugging) console.log('scrolling: detection started');
    const pixels = w * h;
    const points = Math.floor(pixels / scroll_detection_point_divisor);
    const qxBuffer = new ArrayBuffer(2 * points);
    const qx = new Uint16Array(qxBuffer);
    const qyBuffer = new ArrayBuffer(2 * points);
    const qy = new Uint16Array(qyBuffer);
    const qc1Buffer = new ArrayBuffer(4 * points);
    const qc1 = new Uint32Array(qc1Buffer);
    const qc0Buffer = new ArrayBuffer(4 * points);
    const qc0 = new Uint32Array(qc0Buffer);
    for (let i = 0; i < points; i++) {
        const p = Math.floor(Math.random() * pixels);
        // I lost a whole day to find out that p / w is a floating point division,
        // which causes crazy things to happen when we use yy as an array index.
        // I hate JavaScript. -- PG 20201222
        const yy = Math.floor(p / w);
        const xx = p % w;
        const o = (y + yy) * wScreen + x + xx;
        qy[i] = yy;
        qx[i] = xx;
        qc1[i] = px1[o];
        qc0[i] = px0[o];
    }
    const xDensityBuffer = new ArrayBuffer(2 * w);
    const xDensity = new Uint16Array(xDensityBuffer);
    const yDensityBuffer = new ArrayBuffer(2 * h);
    const yDensity = new Uint16Array(yDensityBuffer);
    for (let xx = 0; xx < w; xx++) {
        xDensity[xx] = 0;
        for (let i = 0; i < points; i++) if (qx[i] < xx && qc1[i] != qc0[i]) xDensity[xx]++;
    }
    const lx = Math.floor(w / scroll_detection_length_divisor);
    const halflx = Math.floor(lx / 2);
    const averageDensity = Math.floor(xDensity[w - 1] / scroll_detection_length_divisor);
    if (debugging) console.log('scrolling: averageDensity =', averageDensity);
    let x0 = 0;
    while (x0 + lx < w) {
        while (x0 + lx < w && xDensity[x0 + lx] - xDensity[x0] < averageDensity) x0++;
        let x1 = x0;
        while (x1 + lx < w && xDensity[x1 + lx] - xDensity[x1] >= averageDensity) x1++;
        if (x1 - x0 >= scroll_detection_min_stripe_width) {
            if (debugging) console.log('scrolling: vertical stripe:', x0 + halflx, x1 - x0);
            for (let yy = 0; yy < h; yy++) {
                yDensity[yy] = 0;
                for (let i = 0; i < points; i++)
                    if (qy[i] < yy && qc1[i] != qc0[i] && qx[i] >= x0 && qx[i] < x1) yDensity[yy]++;
            }
            const ly = Math.floor(h / scroll_detection_length_divisor);
            const halfly = Math.floor(ly / 2);
            const averageDensity = Math.floor(yDensity[h - 1] / scroll_detection_length_divisor);
            if (debugging) console.log('scrolling: averageDensity =', averageDensity);
            let y0 = 0;
            while (y0 + ly < h) {
                while (y0 + ly < h && yDensity[y0 + ly] - yDensity[y0] < averageDensity) y0++;
                let y1 = y0;
                while (y1 + ly < h && yDensity[y1 + ly] - yDensity[y1] >= averageDensity) y1++;
                if (y1 - y0 >= scroll_detection_min_stripe_height) {
                    if (debugging)
                        console.log('scrolling: horizontal stripe:', y0 + halfly, y1 - y0);
                    let sx = x0 + halflx;
                    let sy = y0 + halfly;
                    let sw = x1 - x0;
                    let sh = y1 - y0;
                    if (debugging) {
                        console.log('scrolling: checking area:', sx, sy, sw, sh);
                        console.log('scrolling: ' + scrollRects.length.toString() + ' rects');
                    }
                    const redundant = scrollRects.find(function (r) {
                        if (debugging)
                            console.log(
                                'scrolling: checking rect',
                                sx,
                                sy,
                                sw,
                                sh,
                                'against',
                                r.x,
                                r.y,
                                r.w,
                                r.h,
                                r.dx,
                                r.dy
                            );
                        if (sx + sw <= r.x || sx >= r.x + r.w) return 0;
                        else if (sy + sh <= r.y || sy >= r.y + r.h) return 0;
                        else {
                            if (debugging)
                                console.log(
                                    'scrolling: new rect',
                                    sx,
                                    sy,
                                    sw,
                                    sh,
                                    'is redundant with',
                                    r.x,
                                    r.y,
                                    r.w,
                                    r.h,
                                    r.dx,
                                    r.dy
                                );
                            return 1;
                        }
                    });
                    if (!redundant) {
                        const color = new Array();
                        for (let i = 0; i < points; i++)
                            if (qx[i] >= sx && qx[i] < sx + sw && qy[i] >= sy && qy[i] < sy + sh)
                                color.push(qc1[i]);
                        const points_inside = color.length;
                        color.sort(function (a, b) {
                            return a - b;
                        });
                        let color_abundance = 1;
                        let i0 = 0;
                        let i1 = 1;
                        while (i1 < points_inside) {
                            if (color[i1] != color[i0]) {
                                const a = i1 - i0;
                                if (a > color_abundance) {
                                    color_abundance = a;
                                    i0 = i1;
                                }
                            }
                            i1++;
                        }
                        const a = i1 - i0;
                        if (a > color_abundance) color_abundance = a;
                        if (debugging)
                            console.log(
                                'scrolling: color_abundance = ' +
                                    color_abundance.toString() +
                                    ', points_inside = ' +
                                    points_inside.toString() +
                                    ', threshold = ' +
                                    (
                                        points_inside * scroll_detection_same_color_threshold
                                    ).toString()
                            );
                        if (
                            color_abundance <
                            points_inside * scroll_detection_same_color_threshold
                        ) {
                            let min_mishits = points_inside;
                            let sdx = 0;
                            let sdy = 0;
                            // We intentionally include the case dx == dy == 0.
                            // Without this, we get false positives where unchanged content
                            // is scrolled by 1 pixel because the "repair" after the scrolling
                            // is minimal.
                            for (
                                let dy = scroll_detection_y_max;
                                dy >= scroll_detection_y_min && min_mishits > 0;
                                dy--
                            )
                                for (
                                    let dx = scroll_detection_x_max;
                                    dx >= scroll_detection_x_min && min_mishits > 0;
                                    dx--
                                )
                                    if (
                                        dx == 0 ||
                                        dy == 0 ||
                                        dx * dx + dy * dy <
                                            scroll_detection_r_max * scroll_detection_r_max
                                    ) {
                                        let i = 0;
                                        let mishits = 0;
                                        while (i < points && mishits < min_mishits) {
                                            if (
                                                qx[i] >= sx &&
                                                qx[i] < sx + sw &&
                                                qy[i] >= sy &&
                                                qy[i] < sy + sh
                                            ) {
                                                const o0 =
                                                    (y + qy[i] - dy) * wScreen + x + qx[i] - dx;
                                                if (o0 >= 0 && o0 < pixels && qc1[i] != px0[o0])
                                                    mishits++;
                                                // if (i < 10)
                                                //   console.log ("scrolling: point:", qx[i], qy[i], "rect:", sx, sx + sw, sy, sy + sh,
                                                //                "o0, px:", o0, qc1[i], px0[o0]);
                                            }
                                            i++;
                                        }
                                        if (mishits < min_mishits) {
                                            min_mishits = mishits;
                                            sdx = dx;
                                            sdy = dy;
                                        }
                                        if (debugging)
                                            console.log(
                                                'scrolling: dx = ' +
                                                    dx.toString() +
                                                    ', dy = ' +
                                                    dy.toString() +
                                                    ', mishits = ' +
                                                    mishits.toString() +
                                                    ', points_inside = ' +
                                                    points_inside.toString()
                                            );
                                    }
                            if (debugging)
                                console.log(
                                    'scrolling: sdx = ' +
                                        sdx.toString() +
                                        ', sdy = ' +
                                        sdy.toString() +
                                        ', min_mishits = ' +
                                        min_mishits.toString() +
                                        ', points_inside = ' +
                                        points_inside.toString()
                                );
                            if (
                                min_mishits <
                                points_inside * (1 - scroll_detection_hit_threshold)
                            ) {
                                if (debugging)
                                    console.log(
                                        'scrolling: expanding rect:',
                                        sx,
                                        sy,
                                        sw,
                                        sh,
                                        sdx,
                                        sdy
                                    );
                                let xx = sx - 1;
                                let scrollable = 1;
                                while (xx > 0 && scrollable) {
                                    let yy = sy;
                                    let scrollable_points = 0;
                                    let o1 = (y + yy) * wScreen + x + xx;
                                    let o0 = (y + yy - sdy) * wScreen + x + xx - sdx;
                                    while (yy < sy + sh) {
                                        if (px1[o1] == px0[o0]) scrollable_points++;
                                        yy++;
                                        o1 += wScreen;
                                        o0 += wScreen;
                                    }
                                    if (scrollable_points < sh * scroll_detection_hit_threshold)
                                        scrollable = 0;
                                    xx--;
                                }
                                if (!scrollable) sx = xx + 1;
                                else sx = xx;
                                xx = sx + sw;
                                scrollable = 1;
                                while (xx < w && scrollable) {
                                    let yy = sy;
                                    let scrollable_points = 0;
                                    let o1 = (y + yy) * wScreen + x + xx;
                                    let o0 = (y + yy - sdy) * wScreen + x + xx - sdx;
                                    while (yy < sy + sh) {
                                        if (px1[o1] == px0[o0]) scrollable_points++;
                                        yy++;
                                        o1 += wScreen;
                                        o0 += wScreen;
                                    }
                                    if (scrollable_points < sh * scroll_detection_hit_threshold)
                                        scrollable = 0;
                                    xx++;
                                }
                                if (!scrollable) sw = xx - sx - 1;
                                else sw = xx - sx;
                                let yy = sy - 1;
                                scrollable = 1;
                                while (yy > 0 && scrollable) {
                                    let xx = sx;
                                    let scrollable_points = 0;
                                    let o1 = (y + yy) * wScreen + x + xx;
                                    let o0 = (y + yy - sdy) * wScreen + x + xx - sdx;
                                    while (xx < sx + sw) {
                                        if (px1[o1] == px0[o0]) scrollable_points++;
                                        xx++;
                                        o1++;
                                        o0++;
                                    }
                                    if (scrollable_points < sw * scroll_detection_hit_threshold)
                                        scrollable = 0;
                                    yy--;
                                }
                                if (!scrollable) sy = yy + 1;
                                else sy = yy;
                                yy = sy + sh;
                                scrollable = 1;
                                while (yy < h && scrollable) {
                                    let xx = sx;
                                    let scrollable_points = 0;
                                    let o1 = (y + yy) * wScreen + x + xx;
                                    let o0 = (y + yy - sdy) * wScreen + x + xx - sdx;
                                    while (xx < sx + sw) {
                                        if (px1[o1] == px0[o0]) scrollable_points++;
                                        xx++;
                                        o1++;
                                        o0++;
                                    }
                                    if (scrollable_points < sw * scroll_detection_hit_threshold)
                                        scrollable = 0;
                                    yy++;
                                }
                                if (!scrollable) sh = yy - sy - 1;
                                else sh = yy - sy;
                                // if (debugging)
                                console.log('scrolling: pushing rect:', sx, sy, sw, sh, sdx, sdy);
                                scrollRects.forEach(function (r) {
                                    if (
                                        !(
                                            sx + sw <= r.x ||
                                            sx >= r.x + r.w ||
                                            sy + sh <= r.y ||
                                            sy >= r.y + r.h
                                        )
                                    ) {
                                        if (debugging)
                                            console.log(
                                                'scrolling: neutralizing redundant rect:',
                                                r.x,
                                                r.y,
                                                r.w,
                                                r.h,
                                                r.dx,
                                                r.dy
                                            );
                                        r.dx = 0;
                                        r.dy = 0;
                                    }
                                });
                                scrollRects.push(new ScrollParams(sx, sy, sw, sh, sdx, sdy));
                            }
                        }
                    }
                }
                y0 = y1;
            }
        }
        x0 = x1;
    }
    scrollRects.forEach(function (r) {
        if (r.dx != 0 || r.dy != 0) {
            const adx = Math.abs(r.dx);
            const ady = Math.abs(r.dy);
            if (r.w > adx && r.h > ady) {
                // pushRectSolid (r.x, r.y, r.w, r.h, 0xff0000);
                // fillRectBuffer (px0, r.x, r.y, r.w, r.h, 0xffff0000);
                const xx = r.dx > 0 ? r.x + r.dx : r.x;
                const yy = r.dy > 0 ? r.y + r.dy : r.y;
                pushRectScroll(xx, yy, r.w - adx, r.h - ady, xx - r.dx, yy - r.dy);
                scrollRectBuffer(px0, r.x, r.y, r.w, r.h, r.dx, r.dy);
            }
        }
    });
    if (debugging)
        console.log(
            'scrolling: ' +
                scrollRects.length.toString() +
                ' rectangle' +
                (scrollRects.length == 1 ? '' : 's') +
                ' detected'
        );
    scrollRects.length = 0;
}

function determineBackgroundColor(px, x, y, w, h) {
    const pixels = w * h;
    const max_points = Math.floor(pixels / 16);
    const points = max_points > 256 ? 256 : max_points;
    const color = new Array(points);
    for (let i = 0; i < points; i++) {
        const p = Math.floor(Math.random() * pixels);
        const yy = Math.floor(p / w);
        const xx = p % w;
        const o = yy * wScreen + x;
        color[i] = px[o];
    }
    color.sort(function (a, b) {
        return a - b;
    });
    let background_index = 0;
    let background_abundance = 1;
    let i0 = 0;
    let i1 = 1;
    while (i1 < points) {
        if (color[i1] != color[i0]) {
            const a = i1 - i0;
            if (a > background_abundance) {
                background_index = i0;
                background_abundance = a;
                i0 = i1;
            }
        }
        i1++;
    }
    const a = i1 - i0;
    if (a > background_abundance) background_index = i0;
    return color[background_index];
}

async function updateFullRectangle(x, y, w, h) {
    if (w * h * 4 > 1024) await pushRectTight(x, y, w, h);
    else pushRectRaw(x, y, w, h);
}

async function updateInnerStructureHorizontal(px0, px1, x, y, w, h, final) {
    // if (debugging)
    //   console.log ("updateInnerStructureHorizontal: x = " + x.toString () + ", y = " + y.toString ()
    //                + ", w = " + w.toString () + ", h = " + h.toString () + ", final = ", final.toString ());
    const empty = new Array(w);
    const pixel_unchanged = 0x01000000;
    const same_color = 0x2000000;
    let xx = 0;
    while (xx < w) {
        let yy = 0;
        let o = y * wScreen + x + xx;
        const start_color = px1[o];
        empty[xx] = (start_color & 0x00ffffff) | (pixel_unchanged | same_color);
        while (yy < h && empty[xx] & (pixel_unchanged | same_color)) {
            if (px1[o] != px0[o]) empty[xx] &= ~pixel_unchanged;
            if (px1[o] != start_color) empty[xx] &= ~same_color;
            o += wScreen;
            yy++;
        }
        xx++;
    }
    let x0 = 0;
    while (x0 < w && empty[x0] & (pixel_unchanged | same_color)) x0++;
    while (x0 < w) {
        while (x0 < w && !(empty[x0] & (pixel_unchanged | same_color))) x0++;
        let x1 = x0;
        while (x1 < w && empty[x1] & (pixel_unchanged | same_color)) x1++;
        if (x1 < w && x1 - x0 < combine_rects_x_min_distance)
            for (let xx = x0; xx < x1; xx++) empty[xx] &= ~(pixel_unchanged | same_color);
        x0 = x1;
    }
    let nothing_empty = 1;
    for (let xx = 0; xx < w; xx++)
        if (empty[xx] & (pixel_unchanged | same_color)) nothing_empty = 0;
    // if (debugging)
    //   console.log ("nothing_empty = " + nothing_empty.toString () + ", empty =", empty);
    x0 = 0;
    while (x0 < w) {
        let x1 = x0;
        if (empty[x0] & pixel_unchanged) {
            while (x1 < w && empty[x1] & pixel_unchanged) x1++;
        } else if (empty[x0] & same_color) {
            while (
                x1 < w &&
                empty[x1] & same_color &&
                (empty[x1] & 0x00ffffff) == (empty[x0] & 0x00ffffff)
            )
                x1++;
            x1--;
            while (x1 > x0 && empty[x1] & pixel_unchanged) x1--;
            x1++;
            const start_color = empty[x0] | 0xff000000;
            pushRectSolid(x + x0, y, x1 - x0, h, debugging ? start_color | 0x00ffff : start_color);
            fillRectBuffer(px0, x + x0, y, x1 - x0, h, start_color);
        } else {
            while (x1 < w && !(empty[x1] & (pixel_unchanged | same_color))) x1++;
            if (final) await updateFullRectangle(x + x0, y, x1 - x0, h);
            else await updateInnerStructureVertical(px0, px1, x + x0, y, x1 - x0, h, nothing_empty);
        }
        x0 = x1;
    }
}

async function updateInnerStructureVertical(px0, px1, x, y, w, h, final) {
    // if (debugging)
    //   console.log ("updateInnerStructureVertical: x = " + x.toString () + ", y = " + y.toString ()
    //                + ", w = " + w.toString () + ", h = " + h.toString () + ", final = ", final.toString ());
    const empty = new Array(h);
    const pixel_unchanged = 1;
    const same_color = 2;
    let yy = 0;
    while (yy < h) {
        let xx = 0;
        let o = (y + yy) * wScreen + x;
        const start_color = px1[o];
        empty[yy] = (start_color & 0x00ffffff) | (pixel_unchanged | same_color);
        while (xx < w && empty[yy] & (pixel_unchanged | same_color)) {
            if (px1[o] != px0[o]) empty[yy] &= ~pixel_unchanged;
            if (px1[o] != start_color) empty[yy] &= ~same_color;
            o++;
            xx++;
        }
        yy++;
    }
    let y0 = 0;
    while (y0 < h && empty[y0] & (pixel_unchanged | same_color)) y0++;
    while (y0 < h) {
        while (y0 < h && !(empty[y0] & (pixel_unchanged | same_color))) y0++;
        let y1 = y0;
        while (y1 < h && empty[y1] & (pixel_unchanged | same_color)) y1++;
        if (y1 < h && y1 - y0 < combine_rects_y_min_distance)
            for (let yy = y0; yy < y1; yy++) empty[yy] &= ~(pixel_unchanged | same_color);
        y0 = y1;
    }
    let nothing_empty = 1;
    for (let yy = 0; yy < h; yy++)
        if (empty[yy] & (pixel_unchanged | same_color)) nothing_empty = 0;
    // if (debugging)
    //   console.log ("nothing_empty = " + nothing_empty.toString () + ", empty =", empty);
    y0 = 0;
    while (y0 < h) {
        let y1 = y0;
        if (empty[y0] & pixel_unchanged) {
            while (y1 < h && empty[y1] & pixel_unchanged) y1++;
        } else if (empty[y0] & same_color) {
            while (
                y1 < h &&
                empty[y1] & same_color &&
                (empty[y1] & 0x00ffffff) == (empty[y0] & 0x00ffffff)
            )
                y1++;
            y1--;
            while (y1 > y0 && empty[y1] & pixel_unchanged) y1--;
            y1++;
            const start_color = empty[y0] | 0xff000000;
            pushRectSolid(x, y + y0, w, y1 - y0, debugging ? start_color | 0xffff00 : start_color);
            fillRectBuffer(px0, x, y + y0, w, y1 - y0, start_color);
        } else {
            while (y1 < h && !(empty[y1] & (pixel_unchanged | same_color))) y1++;
            if (final) await updateFullRectangle(x, y + y0, w, y1 - y0);
            else
                await updateInnerStructureHorizontal(
                    px0,
                    px1,
                    x,
                    y + y0,
                    w,
                    y1 - y0,
                    nothing_empty
                );
        }
        y0 = y1;
    }
}

async function decomposeRect(px0, px1, x, y, w, h) {
    await updateInnerStructureVertical(px0, px1, x, y, w, h, 0);
}

async function rfbFramebufferUpdate(isIncremental, x, y, w, h) {
    if (debugging)
        console.log(
            'rfbFramebufferUpdate: isIncremental = ' +
                isIncremental.toString() +
                ', x = ' +
                x.toString() +
                ', y = ' +
                h.toString() +
                ', w = ' +
                w.toString() +
                ', h = ' +
                h.toString()
        );
    let id1 = ctx1.getImageData(x, y, w, h);
    ctx0.putImageData(id1, x, y, x, y, w, h);
    const id0 = ctx0.getImageData(0, 0, wScreen, hScreen);
    const px0 = new Uint32Array(id0.data.buffer);
    ctx1.drawImage(video, 0, 0, wScreen, hScreen);
    id1 = ctx1.getImageData(0, 0, wScreen, hScreen);
    let px1 = new Uint32Array(id1.data.buffer);
    if (!isIncremental) {
        const color = determineBackgroundColor(px1, x, y, w, h);
        if (debugging) console.log('background color = ' + color.toString());
        pushRectSolid(x, y, w, h, debugging ? color | 0x7f00ff : color);
        fillRectBuffer(px0, x, y, w, h, color);
    }
    do {
        const length = px0.length;
        let o = 0;
        while (o < length && px0[o] == px1[o]) o++;
        if (o < length) {
            // if (isIncremental && w >= scroll_detection_min_width && h >= scroll_detection_min_height)
            //   detectScrolling (px0, px1, x, y, w, h);
            await decomposeRect(px0, px1, x, y, w, h);
        }
        if (rects.length == 0) {
            await sleep(100);
            ctx1.drawImage(video, 0, 0, wScreen, hScreen);
            id1 = ctx1.getImageData(x, y, w, h);
            px1 = new Uint32Array(id1.data.buffer);
        }
    } while (rects.length == 0);
}

function rfbReceivePixelFormat(buffer, offset) {
    if (debugging) console.log('received: SetPixelFormat');
    const b = new Uint8Array(buffer);
    rfb_bits_per_pixel = b[4];
    rfb_depth = b[5];
    rfb_big_endian_flag = b[6];
    rfb_true_color_flag = b[7];
    rfb_red_maximum = b[8] << (8 + b[9]);
    rfb_green_maximum = b[10] << (8 + b[11]);
    rfb_blue_maximum = b[12] << (8 + b[13]);
    rfb_red_shift = b[14];
    rfb_green_shift = b[15];
    rfb_blue_shift = b[16];
    return 20;
}

function rfbReceiveEncodings(buffer, offset) {
    if (debugging) console.log('received: SetEncodings');
    const b = new Uint8Array(buffer);
    const encodings = b[offset + 2] << (8 + b[offset + 3]);
    return 4 + 4 * encodings;
}

function rfbAbort() {
    if (debugging) console.log('Aborting RFB transmission ...');
    processing += rfb_aborted;
}

async function rfbFramebufferUpdateRequest(buffer, offset) {
    if (debugging) console.log('received: FramebufferUpdateRequest');
    if (processing) {
        if (processing >= rfb_aborted) console.log('aborted');
        else console.log('already being processed');
    } else {
        processing++;
        let b = new Uint8Array(buffer);
        let isIncremental = b[1];
        const x = b[2] * 256 + b[3];
        const y = b[4] * 256 + b[5];
        const w = b[6] * 256 + b[7];
        const h = b[8] * 256 + b[9];
        if (debugging) {
            console.log('FramebufferUpdateRequest: Initiating processing ...');
            console.log('wScreen = ', wScreen, ', hScreen = ', hScreen + ', w = ', w, ', h = ', h);
        }
        rects.length = 0;
        if (processing < rfb_aborted) {
            if (isFirstFrame) {
                await rfbFramebufferUpdate(0, 0, 0, wScreen, hScreen);
                isFirstFrame = 0;
            } else if (isIncremental) await rfbFramebufferUpdate(1, x, y, w, h);
            else await rfbFramebufferUpdate(0, x, y, w, h);
            if (debugging)
                console.log(
                    'FramebufferUpdateRequest: Processing completed. Sending data ... (' +
                        rects.length.toString() +
                        ' rectangle' +
                        (rects.length != 1 ? 's' : '') +
                        ')'
                );
            const header_buffer = new ArrayBuffer(4);
            b = new Uint8Array(header_buffer);
            const num_rects = rects.length;
            b[0] = 0;
            b[1] = rfb_padding;
            b[2] = num_rects >>> 8;
            b[3] = num_rects & 0xff;
            if (debugging)
                console.log('sending rfbFramebufferUpdate header: ' + buf2hex(header_buffer));
            socket.send(header_buffer);
            rects.forEach(function sendIt(r) {
                r.send();
            });
        }
        processing--;
    }
    return 10;
}

function rfbReceiveKeyEvent(buffer, offset) {
    if (debugging) console.log('received: KeyEvent');
    return 8;
}

function rfbReceivePointerEvent(buffer, offset) {
    if (debugging) console.log('received: PointerEvent');
    return 6;
}

function rfbReceiveCutText(buffer, offset) {
    if (debugging) console.log('received: ClientCutText');
    const b = new Uint8Array(buffer);
    const length =
        ((b[offset + 4] << (24 + b[offset + 5])) << (16 + b[offset + 6])) << (8 + b[offset + 7]);
    return 8 + length;
}

function rfbServer(event) {
    if (debugging) console.log('received: ' + buf2hex(event.data));
    const b = new Uint8Array(event.data);
    let offset = 0;
    while (offset < event.data.byteLength) {
        if (debugging) console.log('received RFB packet type ' + b[offset].toString());
        if (b[offset] == 0) offset += rfbReceivePixelFormat(event.data, offset);
        else if (b[offset] == 2) offset += rfbReceiveEncodings(event.data, offset);
        else if (b[offset] == 3) offset += rfbFramebufferUpdateRequest(event.data, offset);
        else if (b[offset] == 4) offset += rfbReceiveKeyEvent(event.data, offset);
        else if (b[offset] == 5) offset += rfbReceivePointerEvent(event.data, offset);
        else if (b[offset] == 6) offset += rfbReceiveCutText(event.data, offset);
        else {
            if (debugging) console.log('unknown RFB packet');
            offset = event.data.byteLength;
        }
    }
}

function rfbFramebufferHandshake(event) {
    if (debugging) console.log('received: ' + buf2hex(event.data));
    socket.removeEventListener('message', rfbFramebufferHandshake);
    socket.addEventListener('message', rfbServer);
    const buffer = new ArrayBuffer(24 + rfb_name_length);
    const b = new Uint8Array(buffer);
    b[0] = wScreen >>> 8;
    b[1] = wScreen & 0xff;
    b[2] = hScreen >>> 8;
    b[3] = hScreen & 0xff;
    b[4] = rfb_bits_per_pixel;
    b[5] = rfb_depth;
    b[6] = rfb_big_endian_flag;
    b[7] = rfb_true_color_flag;
    b[8] = rfb_red_maximum >>> 8;
    b[9] = rfb_red_maximum & 0xff;
    b[10] = rfb_green_maximum >>> 8;
    b[11] = rfb_green_maximum & 0xff;
    b[12] = rfb_blue_maximum >>> 8;
    b[13] = rfb_blue_maximum & 0xff;
    b[14] = rfb_red_shift;
    b[15] = rfb_green_shift;
    b[16] = rfb_blue_shift;
    b[17] = rfb_padding;
    b[18] = rfb_padding;
    b[19] = rfb_padding;
    b[20] = rfb_name_length >>> 24;
    b[21] = rfb_name_length >>> 16;
    b[22] = rfb_name_length >>> 8;
    b[23] = rfb_name_length & 0xff;
    for (let i = 0; i < rfb_name_length; i++) b[24 + i] = rfb_name[i];
    if (debugging) console.log('sending framebuffer parameters: ' + buf2hex(buffer));
    socket.send(buffer);
}

function rfbAuthenticate(event) {
    if (debugging) console.log('received: ' + buf2hex(event.data));
    socket.removeEventListener('message', rfbAuthenticate);
    socket.addEventListener('message', rfbFramebufferHandshake);
    if (debugging) console.log('sending: 00 00 00 00');
    const buffer = new ArrayBuffer(4);
    const b = new Uint8Array(buffer);
    b[0] = 0;
    b[1] = 0;
    b[2] = 0;
    b[3] = 0;
    socket.send(buffer);
}

function rfbSecurityHandshake(event) {
    if (debugging) console.log('received: ' + buf2hex(event.data));
    socket.removeEventListener('message', rfbSecurityHandshake);
    socket.addEventListener('message', rfbAuthenticate);
    if (debugging) console.log('sending: 01 01');
    const buffer = new ArrayBuffer(2);
    const b = new Uint8Array(buffer);
    b[0] = 1;
    b[1] = 1;
    socket.send(buffer);
}

function rfbConnect(event) {
    socket.addEventListener('message', rfbSecurityHandshake);
    if (debugging) console.log('sending: RFB 003.008\\n');
    let utf8Encode = new TextEncoder();
    const buffer = utf8Encode.encode('RFB 003.008\n');
    socket.send(buffer);
}

document.addEventListener('DOMContentLoaded', function () {
    video.addEventListener(
        'play',
        function () {
            wScreen = video.videoWidth;
            hScreen = video.videoHeight;
            canvas1.width = wScreen;
            canvas1.height = hScreen;
            ctx1 = canvas1.getContext('2d');
            canvas0.width = wScreen;
            canvas0.height = hScreen;
            ctx0 = canvas0.getContext('2d');
            ctx0.beginPath();
            ctx0.rect(0, 0, wScreen, hScreen);
            ctx0.fillStyle = 'black';
            ctx0.fill();
            if (debugging) console.log('Opening WebSocket ...');
            let protocol = secure ? 'wss' : 'ws';
            socket = new WebSocket(`${protocol}://${host}${path}`, ['binary', 'base64']);
            socket.binaryType = 'arraybuffer';
            socket.addEventListener('open', rfbConnect);
        },
        false
    );
    video.addEventListener('abort', rfbAbort, false);
    video.addEventListener('emptied', rfbAbort, false);
    video.addEventListener('ended', rfbAbort, false);
    video.addEventListener('error', rfbAbort, false);
    video.addEventListener('pause', rfbAbort, false);
    video.addEventListener('stalled', rfbAbort, false);
    // video.addEventListener ("suspend", rfbAbort, false);
});

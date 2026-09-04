import sys
from pathlib import Path

_cur_dir = str(Path(__file__).resolve().parent)
if _cur_dir not in sys.path:
    sys.path.insert(0, _cur_dir)

import base64
import binascii
import json
import time
import random
from flurl.utils import *
from flurl.request_params import generate_url_params, generate_url_common_params
from flurl.utils  import UUID, md5, generate_mac_address, generate_android_id, gzip_compress, printf, cookie_string, cookie_json, get_trace_id
from flurl.ttEncryptorUtil  import ttEncrypt
import requests
from flurl.core import core_sixgod

def get_post_data(dev_info):
    itime = round(time.time() * 1000)
    gtime = round(time.time() * 1000)
    postDataObj = {
        "magic_tag": "ss_app_log",
        "header":{
            "display_name":"抖音",
            "update_version_code": dev_info['app']['update_version_code'],
            "manifest_version_code": dev_info['app']['manifest_version_code'],
            # "app_version_minor": "",
            "aid": 8662,
            "channel": dev_info['app']['channel'],
            "package": "com.ss.android.ugc.aweme",
            "app_version": dev_info['app']['version_name'],
            "version_code": dev_info['app']['version_code'],
            "sdk_version": "3.7.3-rc.53-douyin-bugfix",
            "sdk_target_version": 29,
            # "git_hash": "600a6e8",
            "os": dev_info['device']['os'],
            "os_version": dev_info['device']['os_version'],
            "os_api": dev_info['device']['os_api'],
            "device_model": dev_info['device']['device_type'],
            "device_brand": dev_info['device']['device_brand'],
            "device_manufacturer": "Google",
            "device_category": "phone",
            "cpu_abi": "arm64-v8a",
            "release_build": f"{UUID()}",
            "density_dpi": dev_info['device']['dpi'],
            "display_density": "mdpi",
            "resolution": dev_info['device']['resolution'].replace('*','x'),
            "language": "zh",
            "mac": generate_mac_address(),
            "timezone": 8,
            "access": "wifi",
            "not_request_sender": 0,
            "carrier": "CHINA MOBILE",
            "mcc_mnc": "46007",
            "rom": dev_info['device']['rom'],
            "rom_version": dev_info['device']['rom_version'],
            # "cdid": dev_info['device']['cdid'],
            "sig_hash": md5(UUID()),
            "openudid": dev_info['device']['openudid'],
            # "udid": dev_info['device']['udid'],
            "clientudid": dev_info['device']['clientudid'],
            "sim_serial_number": [],
            # "ipv6_list": [],
            "region": "CN",
            "tz_name": "Asia/Shanghai",
            "tz_offset": 28800,
            "sim_region": "cn",
            # "oaid_may_support": False,
            # "req_id": UUID(),
            # "device_platform": dev_info['device']['device_platform'],
            # "custom": {
            #     "client_ipv4": "127.0.0.1"
            # },
            # "apk_first_install_time": itime,
            # "is_system_app": 0,
            # "sdk_flavor": "china",
            # "guest_mode": 0
        },
        "_gen_time": gtime
    }

    return gzip_compress(json.dumps(postDataObj).encode(encoding='utf-8'))

def get_headers(dev_info, md5Hash=""):
    extra = {
        "content-type": "application/octet-stream;tt-data=a",
        'X-SS-STUB': md5Hash,
    }
    headers = {
            "accept-encoding": "gzip",
            "log-encode-type": "gzip",
            "x-tt-request-tag": "t=0;n=1",
            "x-ss-req-ticket": str(round(time.time() * 1000)),
            "sdk-version": "2",
            "passport-sdk-version": "203316",
            "x-vc-bdturing-sdk-version": "3.7.4.cn",
            "user-agent": dev_info['extra']['userAgent'],
            "host": "log.snssdk.com",
            "connection": "Keep-Alive",
        }
    if md5Hash:
        return  headers | extra
    return headers

def post_device_register(dev_info, extra, proxy=None):
    """
    Send device register request
    """

    url = "https://log.snssdk.com/service/2/device_register/"

    params = generate_url_params(dev_info, extra)

    req_url = f"{url}?{urllib.parse.urlencode(params)}"

    dev = {}

    gzip_post_data = get_post_data(dev_info)
    post_data = ttEncrypt(gzip_post_data)

    # headers = get_headers(dev_info, md5(post_data))

    headers = {
        "content-type": "application/octet-stream;tt-data=a",
        "accept-encoding": "gzip",
        "user-agent": dev_info['extra']['userAgent'],
        "host": "log.snssdk.com",
        "connection": "Keep-Alive",
    }

    proxies = {"http": proxy, "https": proxy} if proxy else None
    response = requests.post(
        url=req_url,
        headers=headers,
        data=post_data,
        proxies=proxies,
        timeout=15,
    )

    try:
        obj = json.loads(response.text)
        dev_id = str(obj.get("device_id", 0))
        iid = str(obj.get("install_id", 0))
        if dev_id and dev_id != "0":
            dev_info['device']['deviceId'] = dev_id
            dev_info['device']['iid'] = iid
    except Exception:
        pass

    if response.cookies:
        cookies_dict = cookie_json(response)
        dev_info['extra']['cookies'] = json.loads(json.dumps(cookies_dict, indent=4))

    return response

def send_app_alert_check(dev_info, proxy=None):
    """
    Send app alert check
    """

    url = "https://ichannel.snssdk.com/service/2/app_alert_check/"

    extra = {
        'device_id': dev_info['device']['deviceId'],
        'iid': dev_info['device']['iid'],
    }

    params = generate_url_params(dev_info, extra)

    dev = {}

    headers = get_headers(dev_info)

    sign_headers, sign_urls = core_sixgod(surl=url, params=params, devices=dev, header=headers, log=False)

    proxies = {"http": proxy, "https": proxy} if proxy else None
    try:
        response = requests.get(
            sign_urls,
            headers=sign_headers,
            proxies=proxies,
            timeout=15,
        )

        obj = json.loads(response.text)
        if response.cookies:
            cookies_dict = cookie_json(response)
            dev_info['extra']['cookies'] = json.loads(json.dumps(cookies_dict, indent=4))
    except Exception:
        pass

def device_register(proxy=None, max_retries=4):
    """Register device with ByteDance SNSSDK with retries on rate limit."""
    last_res = {"device_id": "", "install_id": "", "platform": "android"}
    for attempt in range(max_retries):
        openudid = generate_android_id()
        uuid = UUID()
        cdid = UUID()
        clientudid = UUID()
        rom = f'EMUI-{rand_str(13)}'

        manifest_version_code = '320901'
        os_version = '10'

        device_type = 'MI 12'
        ttNet = "TTNetVersion:9ac8d95c 2024-11-25 QuicVersion:3f326df4 2024-11-14"

        dev_info = {
            'device':{
                'os': 'Android',
                'device_platform': 'android',
                'device_type': device_type,
                'device_brand': 'Xiaomi',
                'os_api': '29',
                'os_version': os_version,
                'openudid': openudid,
                'resolution': '1440*2392',
                'dpi': '560',
                'cdid': cdid,
                'uuid': uuid,
                'clientudid': clientudid,
                'rom': rom,
                'rom_version': rand_str(2),
            },
            'app': {
                'channel':'douyin-ls-sm-xz-and-20',
                'version_code': '320900',
                'version_name': '32.9.0',
                'manifest_version_code': manifest_version_code,
                'update_version_code': '32909900',
                'okhttp_version': '4.2.210.13-douyin',
            },
            'extra':{
                'userAgent': f'com.ss.android.ugc.aweme/{manifest_version_code} (Linux; U; Android {os_version}; zh_CN; {device_type}; '
                             f'Build/MMB29M; Cronet/{ttNet})',
                'cookies': '',
            }
        }

        extra = {}

        try:
            post_device_register(dev_info, extra, proxy=proxy)
            dev_id = str(dev_info['device'].get('deviceId', '')).strip()
            iid = str(dev_info['device'].get('iid', '')).strip()
            if dev_id and dev_id != '0' and len(dev_id) > 5:
                try:
                    send_app_alert_check(dev_info, proxy=proxy)
                except Exception:
                    pass
                return {
                    "device_id": dev_id,
                    "install_id": iid,
                    "platform": "android",
                }
            last_res = {
                "device_id": dev_id,
                "install_id": iid,
                "platform": "android",
            }
        except Exception:
            pass

        if attempt < max_retries - 1:
            time.sleep(0.35 + random.random() * 0.3)

    return last_res


if __name__ == '__main__':
    device_register()